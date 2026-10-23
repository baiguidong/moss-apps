#!/usr/bin/env python3
"""简历 AI 帮你写：确定性渲染/解析脚本（1:1 对应服务端 prompt 装配逻辑）。

子命令：
  show      --type <dataFieldCode>                          查看类型配置（promptId/模型/变量映射）
  render    --type <dataFieldCode> --stage ask|opt          渲染最终 systemPrompt + 固定 userContent
            --prompt-file <path> [--fields '<json>'] [--qa '<json>']
            （prompt 原文运行时经 MCP 工具 resume_prompt_get 从服务端获取后存为文件传入，不随包分发）
  parse-ask                                                 校验追问输出（stdin），1:1 parseGenerateQuestionResponse
  parse-opt                                                 校验优化输出（stdin），1:1 parseOptimizeResponse
  selfcheck                                                 校验 field-config.json 变量映射自洽性

确定性规则（与 Java 一致，模型不得绕过脚本自行拼装）：
  - 变量值取 fields[请求字段]，空白 → "无"（buildCommonPromptParam）
  - 优化阶段追加 information = "1.{question}\\n答：{answer or 无}\\n" 逐条拼接；无问答 → "无"（buildQuestionParam）
  - user content 恒为 "开始，注意输出格式，注意输出格式"（简历正文走变量，不走 user message）
  - 追问输出必须含非空 question1/2/3；优化输出必须含非空 resume；否则判失败
"""
import json
import re
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = SKILL_DIR / "references" / "field-config.json"

DEFAULT_TEXT = "无"
VAR_RE = re.compile(r"\{\{\$(\w+)\}\}")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def get_type(config: dict, data_field_code: str) -> dict:
    t = config["types"].get(data_field_code)
    if t is None:
        known = "、".join(sorted(config["types"]))
        fail(f"未知 dataFieldCode: {data_field_code}（已知：{known}）")
    return t


def fail(msg: str, code: int = 2):
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(code)


def read_stdin() -> str:
    return sys.stdin.read()


def parse_json_arg(raw: str, what: str):
    try:
        return json.loads(raw)
    except Exception as e:  # noqa: BLE001
        fail(f"{what} 不是合法 JSON: {e}")


def build_variables(type_cfg: dict, fields: dict) -> dict:
    """1:1 buildCommonPromptParam：按 variableMappings 映射，空白填 无。"""
    variables = {}
    for req_field, prompt_var in type_cfg["variableMappings"].items():
        value = fields.get(req_field)
        if value is None or not str(value).strip():
            value = DEFAULT_TEXT
        variables[prompt_var] = str(value)
    return variables


def build_information(qa) -> str:
    """1:1 buildQuestionParam：'1.{question}\\n答：{answer or 无}\\n' 逐条；空 → 无。"""
    if not qa:
        return DEFAULT_TEXT
    parts = []
    for i, item in enumerate(qa):
        question = str(item.get("question") or "").strip()
        answer = str(item.get("answer") or "").strip() or DEFAULT_TEXT
        parts.append(f"{i + 1}.{question}\n答：{answer}\n")
    return "".join(parts)


def cmd_show(config: dict, data_field_code: str):
    t = get_type(config, data_field_code)
    out = {
        "dataFieldCode": data_field_code,
        "label": t.get("label"),
        "moduleCode": t["moduleCode"],
        "ask": {"promptId": t["promptOneId"]},
        "optimize": {"promptId": t["promptTwoId"]},
        "variableMappings": t["variableMappings"],
        "fixedUserContent": config["fixedUserContent"],
        "promptSource": "运行时用 MCP 工具 resume_prompt_get(prompt_id) 从服务端获取，promptId 仅作查找键",
    }
    if t.get("modelException"):
        out["modelException"] = t["modelException"]
    if t.get("note"):
        out["note"] = t["note"]
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_render(config: dict, data_field_code: str, stage: str, fields_raw: str, qa_raw: str, prompt_file: str):
    t = get_type(config, data_field_code)
    fields = parse_json_arg(fields_raw, "--fields") if fields_raw else {}
    if not isinstance(fields, dict):
        fail("--fields 必须是 JSON object，如 '{\"position\":\"测试工程师\"}'")

    prompt_id = t["promptOneId"] if stage == "ask" else t["promptTwoId"]
    if not prompt_file:
        fail(f"缺 --prompt-file：请先用 MCP 工具 resume_prompt_get(prompt_id={prompt_id}) 从服务端获取 prompt 原文并保存为文件传入")
    txt_path = Path(prompt_file)
    if not txt_path.exists():
        fail(f"--prompt-file 不存在: {txt_path}")
    system_prompt = txt_path.read_text(encoding="utf-8")

    variables = build_variables(t, fields)
    if stage == "opt":
        qa = parse_json_arg(qa_raw, "--qa") if qa_raw else None
        if qa is not None and not isinstance(qa, list):
            fail("--qa 必须是 JSON array，如 '[{\"question\":\"...\",\"answer\":\"...\"}]'")
        variables["information"] = build_information(qa)

    def sub(m):
        var = m.group(1)
        if var == "query":
            return m.group(0)  # query 是 user message 占位，不在 systemRole 渲染范围
        if var in variables:
            return variables[var]
        print(f"WARN: systemRole 中的变量 {var} 无映射，按 无 处理", file=sys.stderr)
        return DEFAULT_TEXT

    rendered = VAR_RE.sub(sub, system_prompt)
    out = {
        "dataFieldCode": data_field_code,
        "stage": stage,
        "promptId": prompt_id,
        "variables": variables,
        "systemPrompt": rendered,
        "userContent": config["fixedUserContent"],
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


def strict_parse(raw: str):
    """严格 JSON 解析（对齐 gson 首次解析；失败由模型修复一次后重试）。"""
    if not raw or not raw.strip():
        return None, "blank response"
    try:
        return json.loads(raw), None
    except Exception as e:  # noqa: BLE001
        return None, f"json parse error: {e}"


def cmd_parse_ask():
    raw = read_stdin()
    data, err = strict_parse(raw)
    if err:
        print(json.dumps({"ok": False, "reason": err}, ensure_ascii=False))
        sys.exit(1)
    questions = [str(data.get(f"question{i}") or "").strip() for i in (1, 2, 3)]
    if not isinstance(data, dict) or any(not q for q in questions):
        print(json.dumps({"ok": False, "reason": "question1/2/3 必须全部非空"}, ensure_ascii=False))
        sys.exit(1)
    print(json.dumps({"ok": True, "questions": questions}, ensure_ascii=False, indent=2))


def cmd_parse_opt():
    raw = read_stdin()
    data, err = strict_parse(raw)
    if err:
        print(json.dumps({"ok": False, "reason": err}, ensure_ascii=False))
        sys.exit(1)
    resume = str(data.get("resume") or "").strip() if isinstance(data, dict) else ""
    if not resume:
        print(json.dumps({"ok": False, "reason": "resume 字段为空"}, ensure_ascii=False))
        sys.exit(1)
    out = {
        "ok": True,
        "resume": data["resume"],
        "responsibility": data.get("responsibility"),
        "suggestion": data.get("suggestion"),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_selfcheck(config: dict) -> int:
    problems = []
    for code, t in sorted(config["types"].items()):
        if not t.get("promptOneId") or not t.get("promptTwoId"):
            problems.append(f"{code}: promptOneId/promptTwoId 缺失")
        if not t.get("variableMappings"):
            problems.append(f"{code}: variableMappings 为空")
    if problems:
        for p in problems:
            print(f"FAIL: {p}")
        print(f"selfcheck: {len(problems)} 个问题")
        return 1
    print(f"selfcheck PASS: {len(config['types'])} 类型配置自洽（prompt 原文由服务端维护，运行时经 resume_prompt_get 获取）")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if args else 2
    cmd, rest = args[0], args[1:]

    def opt_value(flag: str):
        if flag in rest:
            i = rest.index(flag)
            if i + 1 >= len(rest):
                fail(f"{flag} 缺参数")
            return rest[i + 1]
        return None

    config = load_json(CONFIG_PATH)

    if cmd == "show":
        cmd_show(config, opt_value("--type") or fail("缺 --type"))
        return 0
    if cmd == "render":
        stage = opt_value("--stage") or fail("缺 --stage ask|opt")
        if stage not in ("ask", "opt"):
            fail("--stage 只支持 ask|opt")
        cmd_render(config, opt_value("--type") or fail("缺 --type"), stage, opt_value("--fields"), opt_value("--qa"), opt_value("--prompt-file"))
        return 0
    if cmd == "parse-ask":
        cmd_parse_ask()
        return 0
    if cmd == "parse-opt":
        cmd_parse_opt()
        return 0
    if cmd == "selfcheck":
        return cmd_selfcheck(config)
    fail(f"未知子命令: {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
