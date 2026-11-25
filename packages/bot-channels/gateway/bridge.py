"""Run one packaged MossWork channel and relay its turns to the Moss host."""
import asyncio
import copy
import hashlib
import json
import logging
import os
import sys
import time
from contextvars import ContextVar
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parent), sys.argv[1]]
import adapter
from moss_gateway.manager import ChannelManager
from moss_gateway.media import FileSystemMediaBackend
from moss_gateway.models import ChannelSubject, MessageEvent

# Gateway diagnostics may contain credentials and message bodies.
logging.disable(logging.CRITICAL)


def emit(event, **data):
    print(json.dumps({"event": event, **data}), flush=True)


def digest(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()


def identify(message):
    meta = message.metadata
    sender = meta.get("sender_id") or meta.get("user_id") or message.channel_subject.subject_id
    chat = meta.get("conversation_id") or meta.get("chat_id") or meta.get("to_handle") or sender
    return str(sender), str(chat), str(meta.get("message_thread_id") or ""), str(
        meta.get("message_id") or meta.get("msg_id") or meta.get("msgid") or ""
    )


def progress_event(data):
    if data["kind"] == "thinking":
        return (MessageEvent.thinking_delta if adapter.kind == "wecom" else MessageEvent.thinking)("正在思考")
    name = data["toolName"]
    if data["phase"] == "started":
        return MessageEvent.tool_start(name, tool_hint_text=f"🔧 正在调用 {name}")
    hint = f"✅ {name} 调用完成" if data["phase"] == "completed" else f"⚠️ {name} 调用失败"
    # WeCom renders tool hints through TOOL_START frames, including completion notices.
    event = MessageEvent.tool_start if adapter.kind == "wecom" else MessageEvent.tool_end
    return event(name, tool_hint_text=hint)


async def run(config):
    options = adapter.settings(config)
    stream = config.get("responseMode", "stream") == "stream"
    account = config.get("accountId")
    if not account:
        # Telegram and Discord tokens include a stable bot ID before the secret.
        separator = ":" if adapter.kind == "telegram" else "."
        prefix, found, _ = config["token"].partition(separator)
        account = digest(prefix if found else config["token"])
    routes = Path(config["routeDir"]) / "deliveries" / digest(account)
    routes.mkdir(mode=0o700, parents=True, exist_ok=True)
    for path in routes.glob("*.json"):
        if time.time() - path.stat().st_mtime > 7 * 86400:
            path.unlink(missing_ok=True)
    queues = {}
    completion = ContextVar("completion")
    last_status = None

    def report(online, error=None):
        nonlocal last_status
        if last_status != (online, error):
            emit("status", connected=online, error=error)
            last_status = (online, error)

    def ack(result, conversation, route):
        if result.get("turnId"):
            emit("delivered", turnId=result["turnId"], externalConversationId=conversation)
        route.unlink(missing_ok=True)

    async def process(message):
        sender, chat, thread, native_id = identify(message)
        if not native_id:
            return
        conversation = adapter.kind + ":" + digest(account, chat, thread)
        event_id = digest(conversation, native_id)
        attachments = [{"type": "image" if part.type == "image" else "file",
                        "name": (getattr(part, "filename", "") or getattr(part, "alt_text", "") or "附件")[:300],
                        "mimeType": getattr(part, "mime_type", "") or "application/octet-stream"}
                       for part in message.content if part.type != "text"][:32]
        text = message.text
        if not text.strip() and not attachments:
            return
        if message.group_context and message.group_context.messages:
            history = "\n".join(f"{item.sender_name or item.sender_id}: {item.text}" for item in message.group_context.messages)
            text = f"[群聊近期消息]\n{history[-12000:]}\n[当前消息]\n{text}"
        if event_id in queues:
            return
        queue = queues[event_id] = asyncio.Queue()
        try:
            subject = message.channel_subject
            # Store only routing fields. WeCom SDK objects and media keys stay in memory.
            keys = ("chat_id", "message_thread_id", "conversation_id", "conversation_type", "webhook_url",
                    "response_url", "msg_type", "msg_id", "guild_id", "channel_id_native", "group_id",
                    "group_openid", "user_openid", "to_handle", "chat_type")
            route = routes / (event_id + ".json")
            tmp = route.with_suffix(".tmp")
            with os.fdopen(os.open(tmp, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600), "w") as output:
                json.dump({"externalConversationId": conversation, "subject": {"subject_id": subject.subject_id,
                           "chat_type": subject.chat_type, "metadata": {k: message.metadata[k] for k in keys if k in message.metadata}}}, output)
            tmp.replace(route)
            report(True)
            emit("message", externalConversationId=conversation, externalEventId=event_id, externalUserId=sender,
                 text=text[:90000], mentioned=bool(message.metadata.get("bot_mentioned")), attachments=attachments)
            async with asyncio.timeout(600):
                while True:
                    result = await queue.get()
                    if "progress" not in result:
                        break
                    if stream:
                        yield progress_event(result["progress"])
            if result.get("text"):
                yield MessageEvent.text(result["text"])
            completion.get().append((result, conversation, route))
            yield MessageEvent.completed()
        except TimeoutError:
            yield MessageEvent.error_event("Moss 处理消息超时")
        finally:
            queues.pop(event_id, None)

    class Channel(adapter.Channel):
        started = False

        async def start(self):
            await super().start()
            self.started = True

        def get_debounce_key(self, message):
            _, chat, thread, _ = identify(message)
            return digest(chat, thread)

        async def _prepare_inbound(self, raw_payload):
            prepared = await super()._prepare_inbound(raw_payload)
            if prepared is None:
                return None
            message, subject = prepared
            # The upstream registry reuses subjects. Keep this turn's reply target
            # when the same sender talks in another chat or forum topic.
            subject = copy.copy(subject)
            subject.metadata = dict(message.metadata)
            message.channel_subject = subject
            return message, subject

        def should_batch_inbound(self, message):
            # Moss deduplicates messages by their native event ID.
            return False

        async def handle_inbound(self, payload):
            finished = []
            token = completion.set(finished)
            try:
                await super().handle_inbound(payload)
                for delivery in finished:
                    ack(*delivery)
            finally:
                completion.reset(token)

    channel = Channel(process, config=options)
    channel.constraints.show_thinking = stream and config.get("showThinking") is True
    channel.constraints.show_tool_hints = stream and config.get("showToolHints") is True
    channel.constraints.thinking_template = "💭 {content}"
    if not stream:
        channel.constraints.typing_keepalive_interval = 0
        channel.constraints.reply_timeout = 0
    manager = ChannelManager({adapter.kind: channel}, media_backend=FileSystemMediaBackend(config["routeDir"]))

    async def monitor():
        started_at = time.monotonic()
        while True:
            online = adapter.connected(channel)
            error = None
            if not online and (time.monotonic() - started_at > 60 or last_status == (True, None)):
                error = "连接尚未恢复，请检查机器人凭据、网络和平台权限"
            if not online and last_status and last_status[1]:
                error = last_status[1]
            report(online, error)
            await asyncio.sleep(1)

    watcher = None
    try:
        await manager.start()
        if not channel.started:
            raise RuntimeError("Channel startup failed")
        watcher = asyncio.create_task(monitor())
        while line := await asyncio.to_thread(sys.stdin.readline):
            result = json.loads(line)
            event_id = result.get("id", "")
            queue = queues.get(event_id)
            if queue is not None:
                if "progress" not in result or queue.qsize() < 16:
                    queue.put_nowait(result)
            elif result.get("turnId") and len(event_id) == 64 and all(c in "0123456789abcdef" for c in event_id):
                route = routes / (event_id + ".json")
                if not route.exists():
                    emit("missing_route", turnId=result["turnId"])
                    continue
                saved = json.loads(route.read_text())
                if result.get("text"):
                    await channel.reply_text(ChannelSubject(**saved["subject"]), result["text"])
                ack(result, saved["externalConversationId"], route)
    finally:
        if watcher:
            watcher.cancel()
        await manager.stop()


if __name__ == "__main__":
    try:
        config = json.loads(sys.stdin.readline())
        asyncio.run(adapter.login(emit) if "--login" in sys.argv else run(config))
    except Exception:
        emit("error", message="连接失败，请检查机器人凭据、网络和平台权限")
        sys.exit(1)
