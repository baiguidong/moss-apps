# -*- coding: utf-8 -*-
"""简历附件统一解析入口（Task 1：CLI 壳 + 错误协议 + runtime 哨兵重执行）。

本脚本是 resume-ai-help skill 解析附件的唯一入口。用户和模型只允许运行：

    python scripts/extract_resume_text.py "<附件路径>" --out <输出json>

设计：
- 本文件自身只依赖标准库，任何环境都能启动；
- 启动时若发现不在固定 runtime 内，用固定 runtime 的解释器重执行自身；
- runtime 不存在时返回 RUNTIME_MISSING + 唯一修复命令，绝不临时联网装包；
- 真实 converter 在 Task 3-5 接入；Task 1 阶段所有走到路由的请求返回 EXTRACTION_FAILED。

退出码协议：成功 exit 0；失败 exit 1（失败也输出 stdout JSON）。
--out 协议：失败时不写 --out 文件（让下游找不到产物自然中断）。
哨兵机制：用环境变量 RESUME_PARSER_IN_RUNTIME 标记"已在 runtime 内"，
  避免靠 sys.executable 路径字符串比对判 runtime（Windows launcher/junction 会判错）。
"""
import json
import os
import sys
from pathlib import Path

# 哨兵环境变量：=1 表示当前进程已在固定 runtime 内，不再重执行
SENTINEL_ENV = "RESUME_PARSER_IN_RUNTIME"
# runtime 根目录覆盖环境变量
RUNTIME_ENV = "RESUME_AI_HELP_RUNTIME"
# 唯一修复命令（setup 真身在 Task 6 实现，字符串在此钉死）
SETUP_COMMAND = "python scripts/setup_parser_runtime.py"

# 支持的附件格式
SUPPORTED_FORMATS = {"pdf", "docx", "doc", "txt", "md"}

# 错误码
CODE_RUNTIME_MISSING = "RUNTIME_MISSING"
CODE_UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
CODE_FILE_NOT_FOUND = "FILE_NOT_FOUND"
CODE_EXTRACTION_FAILED = "EXTRACTION_FAILED"


def locate_runtime_python():
    """定位固定 runtime 的 python 解释器路径。返回 Path 或 None。

    优先级：RESUME_AI_HELP_RUNTIME 环境变量 > %LOCALAPPDATA%\\speckit-demo\\resume-parser\\venv。
    返回的是 <runtime>/Scripts/python.exe，调用方需自行 exists() 判定。
    """
    env_runtime = os.environ.get(RUNTIME_ENV)
    if env_runtime:
        return Path(env_runtime) / "Scripts" / "python.exe"
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        return None
    return Path(local) / "speckit-demo" / "resume-parser" / "venv" / "Scripts" / "python.exe"


def emit_json(obj, out_path=None):
    """输出 JSON。成功时同时写 --out 文件；失败时不写 --out（由调用方保证）。

    stdout 始终输出 JSON（UTF-8，ensure_ascii=False，字段顺序稳定）。
    """
    text = json.dumps(obj, ensure_ascii=False)
    sys.stdout.buffer.write((text + "\n").encode("utf-8"))
    sys.stdout.flush()
    if out_path and obj.get("ok") is True:
        Path(out_path).write_text(text, encoding="utf-8")


def error_result(code, message, **extra):
    """构造失败 JSON。字段固定顺序：ok, code, message, ...nextCommand。"""
    result = {"ok": False, "code": code, "message": message}
    result.update(extra)
    return result


def detect_format(path: Path) -> str:
    """按扩展名识别格式（小写）。Task 1 不读全文件做 magic bytes，扩展名足够路由。"""
    return path.suffix.lower().lstrip(".")


def reexec_in_runtime(runtime_python: Path, argv):
    """用固定 runtime 的解释器重执行自身，设上哨兵后 execve 替换当前进程。

    execve 成功后不返回。失败（假 runtime、权限、文件非可执行）抛 OSError 时，
    由调用方捕获并返回明确错误，不得冒成 traceback，也不得返回 RUNTIME_MISSING
    （runtime 文件本身存在，是 execve 失败，不是 runtime 缺失）。
    """
    env = os.environ.copy()
    env[SENTINEL_ENV] = "1"
    # os.execve 原子替换当前进程；argv[0] 给目标解释器，其余是脚本路径+原参数
    os.execve(str(runtime_python), [str(runtime_python), __file__, *argv], env)


def main(argv):
    # ---- runtime 定位与自重执行（哨兵机制，评审红线）----
    if os.environ.get(SENTINEL_ENV) != "1":
        runtime_python = locate_runtime_python()
        if runtime_python is None or not runtime_python.exists():
            emit_json(error_result(
                CODE_RUNTIME_MISSING,
                "简历解析固定 runtime 不存在，请先运行唯一初始化命令",
                nextCommand=SETUP_COMMAND,
            ))
            return 1
        # runtime 存在 → 重执行到 runtime python（哨兵随之带过去）
        try:
            reexec_in_runtime(runtime_python, argv)
        except OSError as e:
            # execve 失败（假 runtime / 权限 / 文件非可执行）。runtime 文件本身存在，
            # 不是缺失，不得误报 RUNTIME_MISSING。返回明确的执行失败。
            emit_json(error_result(
                CODE_EXTRACTION_FAILED,
                f"runtime 存在但重执行失败：{e}",
                nextCommand=SETUP_COMMAND,
            ))
            return 1
        # execve 成功后不会返回
        return 1  # 兜底，正常不走到

    # ---- 到这里一定在 runtime 内，哨兵已设 ----
    # 解析参数
    if not argv:
        emit_json(error_result(
            CODE_UNSUPPORTED_FORMAT,
            "缺少附件路径参数",
        ))
        return 1
    src = Path(argv[0])
    out_path = None
    rest = argv[1:]
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--out" and i + 1 < len(rest):
            out_path = rest[i + 1]
            i += 2
        else:
            i += 1

    # ---- 文件级硬校验（标准库，不依赖 runtime 内的包）----
    if not src.exists():
        emit_json(error_result(
            CODE_FILE_NOT_FOUND,
            f"附件不存在：{src}",
            sourcePath=str(src),
        ))
        return 1

    fmt = detect_format(src)
    if fmt not in SUPPORTED_FORMATS:
        emit_json(error_result(
            CODE_UNSUPPORTED_FORMAT,
            f"仅支持 PDF、DOCX、DOC、TXT、MD，收到 .{fmt}",
            sourcePath=str(src),
        ))
        return 1

    # ---- 格式路由（Task 1 stub：真实 converter 在 Task 3-5 接入）----
    # Task 1 阶段所有走到这里的请求都返回 EXTRACTION_FAILED，证明哨兵短路成功、
    # 进入干活分支，但 converter 尚未实现。
    emit_json(error_result(
        CODE_EXTRACTION_FAILED,
        f"格式 {fmt} 的 converter 尚未接入（Task 3-5 实现）",
        sourcePath=str(src),
        sourceFormat=fmt,
    ), out_path=out_path)
    return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
