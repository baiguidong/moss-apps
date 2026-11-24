"""Bind Moss agent turns to the upstream moss-gateway Feishu channel."""

import asyncio
import hashlib
import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, sys.argv[1])

import lark_oapi
import lark_oapi.ws
from moss_gateway.channels import feishu
from moss_gateway.models import ChannelSubject, MessageEvent

logging.disable(logging.CRITICAL)


def emit(event, **payload):
    print(json.dumps({"event": event, **payload}, ensure_ascii=True), flush=True)


async def main(config, *, probe):
    if config.get("domain") == "lark":
        # The upstream channel defaults to Feishu's China domain.
        feishu._API_BASE = "https://open.larksuite.com/open-apis"
        ws_client = lark_oapi.ws.Client
        lark_oapi.ws.Client = lambda *args, **kwargs: ws_client(
            *args, **kwargs, domain="https://open.larksuite.com"
        )
    pending = {}
    stream = config.get("responseMode", "stream") == "stream"
    allowed_users = set(config.get("allowedUsers") or [])
    routes = None
    if not probe:
        app_key = hashlib.sha256(config["appId"].encode()).hexdigest()
        routes = Path(config["routeDir"]) / "feishu-deliveries" / app_key
        routes.mkdir(parents=True, exist_ok=True)
        now = time.time()
        for route in routes.glob("*.json"):
            if now - route.stat().st_mtime > 7 * 24 * 60 * 60:
                route.unlink(missing_ok=True)

    def route_for(event_id):
        assert routes is not None
        return routes / (hashlib.sha256(event_id.encode()).hexdigest() + ".json")

    def delivered(result, subject, route):
        if result.get("turnId"):
            emit("delivered", turnId=result["turnId"], externalConversationId=subject.subject_id)
        route.unlink(missing_ok=True)

    async def process(message):
        meta = message.metadata
        event_id = meta.get("message_id")
        user_id = meta.get("sender_open_id")
        if probe or not event_id or not user_id or (allowed_users and user_id not in allowed_users):
            return
        if meta.get("chat_type") == "group" and not meta.get("bot_mentioned"):
            return
        # The Host retains attachment metadata only on externally routed turns.
        attachments = [
            {"type": "image" if part.type == "image" else "file",
             "name": (getattr(part, "filename", "") or "飞书附件")[:300],
             "mimeType": getattr(part, "mime_type", "") or "application/octet-stream"}
            for part in message.content if part.type != "text"
        ][:32]
        context = message.group_context
        text = message.text
        if context and context.messages:
            history = "\n".join(f"{item.sender_id}: {item.text}" for item in context.messages if item.text)
            if history:
                text = f"{history}\n\n{text}"
        if not text.strip() and not attachments:
            return
        subject = message.channel_subject
        route = route_for(event_id)
        temporary = route.with_suffix(".tmp")
        temporary.write_text(json.dumps({
            "subject_id": subject.subject_id,
            "chat_type": subject.chat_type,
            "metadata": subject.metadata,
        }), encoding="utf-8")
        temporary.replace(route)
        response = asyncio.Queue()
        pending[event_id] = response
        try:
            emit("message", **{
                "externalConversationId": message.channel_subject.subject_id,
                "externalUserId": user_id,
                "externalEventId": event_id,
                "text": text[:90000],
                "mentioned": bool(meta.get("bot_mentioned")),
                "attachments": attachments,
            })
            async with asyncio.timeout(600):
                while True:
                    result = await response.get()
                    if "progress" not in result:
                        break
                    try:
                        await asyncio.wait_for(channel.send_progress(subject, result["progress"]), timeout=3)
                    except Exception:
                        # A failed status hint must not prevent the final reply.
                        continue
            if result.get("text"):
                yield MessageEvent.text(result["text"])
            delivered(result, subject, route)
            yield MessageEvent.completed()
        except TimeoutError:
            yield MessageEvent.error_event("Moss 处理消息超时")
        finally:
            pending.pop(event_id, None)

    class Channel(feishu.FeishuChannel):
        def _add_reaction_async(self, message_id, emoji_type="Typing"):
            if not probe and stream:
                super()._add_reaction_async(message_id, emoji_type)

        async def send_progress(self, subject, progress):
            if progress["kind"] == "thinking":
                await self._on_thinking(subject, MessageEvent.thinking("正在思考"))
            elif progress["kind"] == "tool":
                name = progress["toolName"]
                phase = progress["phase"]
                if phase == "started":
                    await self._on_tool_start(subject, MessageEvent.tool_start(name, tool_hint_text=f"🔧 正在调用 {name}"))
                elif phase == "completed":
                    await self._on_tool_end(subject, MessageEvent.tool_end(name, tool_hint_text=f"✅ {name} 调用完成"))
                elif phase == "failed":
                    await self._on_tool_end(subject, MessageEvent.tool_end(name, tool_hint_text=f"⚠️ {name} 调用失败"))

        async def _send_message(self, **kwargs):
            result = await super()._send_message(**kwargs)
            if result.get("code") != 0:
                raise RuntimeError("Feishu refused the reply")
            return result

    channel = Channel(process, feishu.FeishuConfig(
        app_id=config["appId"],
        app_secret=config["appSecret"],
        encrypt_key=config.get("encryptKey") or "",
        verification_token=config.get("verificationToken") or "",
        show_thinking=stream and config.get("showThinking") is True,
        show_tool_hints=stream and config.get("showToolHints") is True,
    ))
    channel.constraints.thinking_template = "💭 {content}"
    # The existing SDK writes diagnostic output to stderr.
    async def connected():
        while True:
            if getattr(channel._ws_client, "_conn", None) is not None:
                return True
            await asyncio.sleep(0.25)

    async def publish_status():
        previous = None
        while True:
            online = getattr(channel._ws_client, "_conn", None) is not None
            if online != previous:
                emit("status", connected=online)
                previous = online
            await asyncio.sleep(0.5)

    reader = None
    try:
        if probe:
            await asyncio.wait_for(channel.start(), timeout=15)
            await asyncio.wait_for(connected(), timeout=15)
            emit("status", connected=True)
            return
        await channel.start()
        reader = asyncio.create_task(publish_status())
        while line := await asyncio.to_thread(sys.stdin.readline):
            result = json.loads(line)
            response = pending.get(result.get("id"))
            if "progress" in result:
                if response is not None and response.qsize() < 16:
                    response.put_nowait(result)
                continue
            if response is not None:
                response.put_nowait(result)
                continue
            if not result.get("turnId") or not result.get("id"):
                continue
            route = route_for(result["id"])
            try:
                subject = ChannelSubject(**json.loads(route.read_text(encoding="utf-8")))
            except FileNotFoundError:
                emit("missing_route", turnId=result["turnId"])
                continue
            if result.get("text"):
                await channel.reply_text(subject, result["text"])
            delivered(result, subject, route)
    finally:
        if reader:
            reader.cancel()
        await channel.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main(json.loads(sys.stdin.readline()), probe="--probe" in sys.argv))
    except Exception:
        emit("error", message="连接失败，请检查机器人凭据及飞书长连接设置")
        sys.exit(1)
