#!/usr/bin/env python3
"""Deterministic state machine for whole-resume AI-help orchestration.

The runner does not call an LLM.  It emits exactly one next action and the
fully rendered prompt for that action, then persists progress after the caller
records the decision, answers, or optimized result.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "references" / "field-config.json"
AIHELP_PATH = Path(__file__).with_name("aihelp.py")
HTML_PATH = Path(__file__).with_name("render_resume_html.py")
TEMPLATES_PATH = ROOT / "references" / "export" / "templates"


def read_json(path: str | Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: str | Path, value) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, target)


def blank(value) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def first_field(finalized: dict, code: str) -> str:
    candidates = []
    for module in finalized.get("modules", []):
        for record in module.get("records", []):
            if record.get("dataFieldCode") == code and not blank(record.get("value")):
                candidates.append(record)
    candidates.sort(key=lambda x: (x.get("dataSort", 1), x.get("fieldIndex", 0)))
    return candidates[0]["value"] if candidates else ""


def build_items(finalized: dict, config: dict) -> list[dict]:
    modules = {m.get("moduleCode"): m for m in finalized.get("modules", [])}
    position = first_field(finalized, "position")
    items = []
    # JSON insertion order is the authoritative whole-resume optimization order.
    for field_code, type_cfg in config["types"].items():
        module = modules.get(type_cfg["moduleCode"])
        if not module or module.get("configHidden") or module.get("moduleStatus") == 0:
            continue
        records = module.get("records", [])
        sorts = sorted(
            {
                int(r.get("dataSort", 1))
                for r in records
                if r.get("dataFieldCode") == field_code
                and r.get("dataFieldStatus", 1) != 0
                and not blank(r.get("value"))
            }
        )
        for data_sort in sorts:
            fields = {
                r["dataFieldCode"]: r.get("value", "")
                for r in sorted(records, key=lambda x: x.get("fieldIndex", 0))
                if int(r.get("dataSort", 1)) == data_sort
            }
            fields["position"] = position
            items.append(
                {
                    "moduleCode": type_cfg["moduleCode"],
                    "dataFieldCode": field_code,
                    "dataSort": data_sort,
                    "label": type_cfg["label"],
                    "promptOneId": type_cfg["promptOneId"],
                    "promptTwoId": type_cfg["promptTwoId"],
                    "fields": fields,
                    "status": "awaiting_follow_up",
                    "qa": None,
                }
            )
    return items


def render_prompt(item: dict, stage: str) -> dict:
    import importlib.util

    spec = importlib.util.spec_from_file_location("resume_aihelp", AIHELP_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    config = module.load_json(module.CONFIG_PATH)
    index = module.load_json(module.INDEX_PATH)
    output = io.StringIO()
    qa = json.dumps(item.get("qa"), ensure_ascii=False) if item.get("qa") is not None else None
    with contextlib.redirect_stdout(output):
        module.cmd_render(
            config,
            index,
            item["dataFieldCode"],
            stage,
            json.dumps(item["fields"], ensure_ascii=False),
            qa,
        )
    return json.loads(output.getvalue())


def load_state(path: str | Path) -> dict:
    state = read_json(path)
    if state.get("version") != 1:
        raise SystemExit("不支持的 runner state 版本")
    return state


def current_item(state: dict) -> dict | None:
    index = state["currentIndex"]
    return state["items"][index] if index < len(state["items"]) else None


def save_state(args, state: dict) -> None:
    write_json(args.state, state)


def renderer_preflight() -> dict[str, str]:
    try:
        import jinja2  # noqa: F401
    except ImportError as exc:
        raise SystemExit("初始化失败：缺少 HTML 渲染依赖 jinja2，请先安装项目依赖") from exc
    if not TEMPLATES_PATH.is_dir() or not any(TEMPLATES_PATH.glob("personal_resume_onepage_*.html")):
        raise SystemExit(f"初始化失败：未找到 HTML 模板：{TEMPLATES_PATH}")
    return {"jinja2": "ok", "templates": "ok"}


def cmd_init(args):
    preflight = renderer_preflight()
    finalized_path = Path(args.finalized).resolve()
    finalized = read_json(finalized_path)
    config = read_json(CONFIG_PATH)
    overrides_path = Path(args.overrides).resolve() if args.overrides else Path(args.state).resolve().with_name("overrides.json")
    state = {
        "version": 1,
        "finalized": str(finalized_path),
        "overrides": str(overrides_path),
        "currentIndex": 0,
        "items": build_items(finalized, config),
    }
    write_json(overrides_path, [])
    save_state(args, state)
    print(
        json.dumps(
            {"itemCount": len(state["items"]), "state": str(Path(args.state).resolve()), "preflight": preflight},
            ensure_ascii=False,
        )
    )


def cmd_next(args):
    state = load_state(args.state)
    item = current_item(state)
    if item is None:
        print(json.dumps({"action": "render_html", "completed": len(state["items"]), "overrides": state["overrides"]}, ensure_ascii=False))
        return
    public_item = {k: v for k, v in item.items() if k not in {"status", "qa"}}
    status = item["status"]
    if status == "awaiting_follow_up":
        prompt = render_prompt(item, "ask")
        result = {
            "action": "ask",
            "requiresUserInput": True,
            "stopAfterDisplay": True,
            "allowedTransitions": ["answers --qa", "skip-questions --confirmed-by-user"],
            "item": public_item,
            **prompt,
        }
    elif status == "awaiting_optimize":
        prompt = render_prompt(item, "opt")
        result = {"action": "optimize", "item": public_item, **prompt}
    else:
        raise SystemExit(f"非法当前状态: {status}")
    print(json.dumps(result, ensure_ascii=False, indent=2))


def cmd_answers(args):
    state = load_state(args.state)
    item = current_item(state)
    if not item or item["status"] != "awaiting_follow_up":
        raise SystemExit("answers 仅允许用于当前追问项目")
    qa = json.loads(args.qa)
    if not isinstance(qa, list):
        raise SystemExit("--qa 必须是 JSON 数组")
    if not any(isinstance(row, dict) and not blank(row.get("answer")) for row in qa):
        raise SystemExit("answers 至少需要一个用户答案；全部跳过请使用 skip-questions --confirmed-by-user")
    item["qa"] = qa
    item["status"] = "awaiting_optimize"
    save_state(args, state)


def cmd_skip_questions(args):
    state = load_state(args.state)
    item = current_item(state)
    if not item or item["status"] != "awaiting_follow_up":
        raise SystemExit("skip-questions 仅允许用于当前追问项目")
    if not args.confirmed_by_user:
        raise SystemExit("只有用户明确跳过追问后才允许推进")
    item["qa"] = None
    item["status"] = "awaiting_optimize"
    save_state(args, state)


def cmd_complete(args):
    state = load_state(args.state)
    item = current_item(state)
    if not item or item["status"] != "awaiting_optimize":
        raise SystemExit("complete 仅允许在当前项目进入优化阶段后执行")
    response_path = Path(args.response_file)
    if not response_path.is_file():
        raise SystemExit(f"优化响应文件不存在: {response_path}")
    parsed = subprocess.run(
        [sys.executable, str(AIHELP_PATH), "parse-opt"],
        input=response_path.read_bytes(),
        capture_output=True,
    )
    if parsed.returncode:
        reason = parsed.stdout.decode("utf-8", errors="replace").strip()
        raise SystemExit(f"优化响应未通过 parse-opt 校验: {reason}")
    result = json.loads(parsed.stdout.decode("utf-8"))
    resume = result["resume"].strip()
    if "\\n" in resume or "\\r" in resume:
        raise SystemExit("优化结果含字面量 \\n/\\r；请将 LLM 原始 JSON 直接落盘，禁止经 shell 参数转写")
    overrides = read_json(state["overrides"])
    overrides.append(
        {
            "moduleCode": item["moduleCode"],
            "dataFieldCode": item["dataFieldCode"],
            "dataSort": item["dataSort"],
            "value": resume,
        }
    )
    write_json(state["overrides"], overrides)
    item["status"] = "completed"
    state["currentIndex"] += 1
    save_state(args, state)


def cmd_skip_item(args):
    state = load_state(args.state)
    item = current_item(state)
    if not item:
        raise SystemExit("没有可跳过的当前项目")
    item["status"] = "skipped"
    state["currentIndex"] += 1
    save_state(args, state)


def cmd_render_html(args):
    state = load_state(args.state)
    if current_item(state) is not None:
        raise SystemExit("仍有未处理项目，禁止提前生成 HTML")
    command = [
        sys.executable,
        str(HTML_PATH),
        "render",
        "--finalized",
        state["finalized"],
    ]
    if read_json(state["overrides"]):
        command.extend(["--overrides", state["overrides"]])
    command.extend(
        [
            "--template-code",
            args.template_code,
            "--resume-name",
            args.resume_name,
            "--out",
            args.out,
        ]
    )
    result = subprocess.run(command, capture_output=True)
    for stream, target in ((result.stdout, sys.stdout), (result.stderr, sys.stderr)):
        if stream:
            try:
                target.write(stream.decode("utf-8"))
            except UnicodeDecodeError:
                target.write(stream.decode("gbk", errors="replace"))
    if result.returncode:
        raise SystemExit(result.returncode)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="整份简历逐项 Prompt 确定性编排器")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init")
    p.add_argument("--finalized", required=True)
    p.add_argument("--state", required=True)
    p.add_argument("--overrides")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("next")
    p.add_argument("--state", required=True)
    p.set_defaults(func=cmd_next)

    p = sub.add_parser("answers")
    p.add_argument("--state", required=True)
    p.add_argument("--qa", required=True)
    p.set_defaults(func=cmd_answers)

    p = sub.add_parser("skip-questions")
    p.add_argument("--state", required=True)
    p.add_argument("--confirmed-by-user", action="store_true", required=True)
    p.set_defaults(func=cmd_skip_questions)

    p = sub.add_parser("complete")
    p.add_argument("--state", required=True)
    p.add_argument("--response-file", required=True)
    p.set_defaults(func=cmd_complete)

    p = sub.add_parser("skip-item")
    p.add_argument("--state", required=True)
    p.add_argument("--confirmed-by-user", action="store_true", required=True)
    p.set_defaults(func=cmd_skip_item)

    p = sub.add_parser("render-html")
    p.add_argument("--state", required=True)
    p.add_argument("--resume-name", required=True)
    p.add_argument("--template-code", default="default")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_render_html)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
