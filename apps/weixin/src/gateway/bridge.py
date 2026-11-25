"""Connect the Moss agent turn protocol to MossWork's Weixin iLink adapter."""

import asyncio
import hashlib
import json
import logging
import os
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, sys.argv[1])

from moss_gateway.channel import BaseChannel
from moss_gateway.channels.weixin import WeixinChannel, WeixinConfig, WeixinQRLogin
from moss_gateway.channels.weixin.types import GetUpdatesResponse, WeixinAPIError
from moss_gateway.manager import ChannelManager
from moss_gateway.media import FileSystemMediaBackend
from moss_gateway.models import ChannelSubject, MessageEvent

logging.disable(logging.CRITICAL)


def emit(event, **payload):
    print(json.dumps({"event": event, **payload}), flush=True)


async def login():
    class Login(WeixinQRLogin):
        async def fetch_qr_code(self, reset_refresh_count=True):
            qr = await super().fetch_qr_code(reset_refresh_count)
            # The upstream poller also calls this hook when it replaces an expired QR.
            emit("qr", url=qr.qrcode_img_content)
            return qr

    flow = Login()
    qr = await flow.fetch_qr_code()
    result = await flow.wait_for_login(qr.qrcode, on_scanned=lambda: emit("scanned"))
    if not result.connected or not result.bot_token:
        emit("error")
        return
    emit("confirmed", accountId=result.account_id or "weixin", token=result.bot_token,
         baseUrl=result.base_url or "https://ilinkai.weixin.qq.com")


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


async def send_progress(channel, subject, progress):
    if progress["kind"] == "thinking":
        return await channel._on_thinking(subject, MessageEvent.thinking("正在思考"))
    name = progress["toolName"]
    phase = progress["phase"]
    if phase == "started":
        return await channel._on_tool_start(subject, MessageEvent.tool_start(name, tool_hint_text=f"🔧 正在调用 {name}"))
    hint = f"✅ {name} 调用完成" if phase == "completed" else f"⚠️ {name} 调用失败"
    await channel._on_tool_end(subject, MessageEvent.tool_end(name, tool_hint_text=hint))


async def run_channel(config):
    account_id = config["accountId"]
    stream = config.get("responseMode", "stream") == "stream"
    routes = Path(config["routeDir"]) / "weixin-deliveries" / digest(account_id)
    routes.mkdir(mode=0o700, parents=True, exist_ok=True)
    for route in routes.glob("*.json"):
        if time.time() - route.stat().st_mtime > 7 * 86400:
            route.unlink(missing_ok=True)
    pending = {}

    def conversation_id(user_id):
        return "weixin:" + digest(json.dumps([account_id, user_id]))

    def delivered(result, subject, route):
        if result.get("turnId"):
            emit("delivered", turnId=result["turnId"], externalConversationId=conversation_id(subject.subject_id))
        route.unlink(missing_ok=True)

    async def process(message):
        subject = message.channel_subject
        user_id = message.metadata.get("from_user_id")
        if not subject or not user_id:
            return
        conversation = conversation_id(user_id)
        message_id = message.metadata.get("_weixin_msg_id") or uuid.uuid4().hex
        event_id = digest(conversation + ":" + message_id)
        if event_id in pending:
            return
        attachments = [
            {"type": "image" if part.type == "image" else "file",
             "name": (getattr(part, "filename", "") or "微信附件")[:300],
             "mimeType": getattr(part, "mime_type", "") or "application/octet-stream"}
            for part in message.content if part.type != "text"
        ][:32]
        if not message.text.strip() and not attachments:
            return
        route = routes / (digest(event_id) + ".json")
        temporary = route.with_suffix(".tmp")
        # A persisted subject includes the iLink context token required for replay.
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as output:
            json.dump({"subject_id": subject.subject_id, "metadata": subject.metadata}, output)
        temporary.replace(route)
        queue = asyncio.Queue()
        pending[event_id] = queue
        try:
            emit("message", externalConversationId=conversation, externalUserId=user_id, externalEventId=event_id,
                 text=message.text[:90000], mentioned=False, attachments=attachments)
            async with asyncio.timeout(600):
                while True:
                    result = await queue.get()
                    if "progress" not in result:
                        break
                    try:
                        await asyncio.wait_for(send_progress(channel, subject, result["progress"]), timeout=3)
                    except Exception:
                        # As in Feishu, a failed hint must not interrupt the final reply.
                        continue
            if result.get("text"):
                yield MessageEvent.text(result["text"])
            delivered(result, subject, route)
            yield MessageEvent.completed()
        except TimeoutError:
            yield MessageEvent.error_event("Moss 处理消息超时")
        finally:
            pending.pop(event_id, None)

    class Channel(WeixinChannel):
        async def _process_inbound(self, message, subject):
            if stream:
                return await super()._process_inbound(message, subject)
            # The Weixin override starts typing and a fallback bubble for every turn.
            return await BaseChannel._process_inbound(self, message, subject)

        async def _get_updates(self, account, buf, timeout_ms):
            api = await self._api(account)
            try:
                updates = await api.get_updates(buf, timeout_ms=timeout_ms)
            except TimeoutError:
                return GetUpdatesResponse(get_updates_buf=buf)
            except WeixinAPIError as exc:
                expired = exc.errcode in (-2, -14) or exc.ret in (-2, -14)
                emit("status", connected=False, error="微信登录已失效，请重新扫码" if expired else "微信连接中断，正在重试")
                raise
            except Exception:
                emit("status", connected=False, error="微信连接中断，正在重试")
                raise
            emit("status", connected=True)
            return updates

    channel = Channel(process, config=WeixinConfig.from_dict({
        "account_id": account_id, "token": config["token"], "base_url": config["baseUrl"],
        "media_dir": str(Path(config["routeDir"]) / "media"),
    }))
    channel.constraints.show_thinking = stream and config.get("showThinking") is True
    channel.constraints.show_tool_hints = stream and config.get("showToolHints") is True
    channel.constraints.thinking_template = "💭 {content}"
    manager = ChannelManager({account_id: channel}, media_backend=FileSystemMediaBackend(config["routeDir"]))
    try:
        await manager.start()
        while line := await asyncio.to_thread(sys.stdin.readline):
            result = json.loads(line)
            event_id = result.get("id")
            queue = pending.get(event_id)
            if "progress" in result:
                if queue is not None and queue.qsize() < 16:
                    queue.put_nowait(result)
            elif queue is not None:
                queue.put_nowait(result)
            elif result.get("turnId") and event_id:
                route = routes / (digest(event_id) + ".json")
                if not route.exists():
                    emit("missing_route", turnId=result["turnId"])
                    continue
                subject = ChannelSubject(**json.loads(route.read_text(encoding="utf-8")))
                if result.get("text"):
                    await channel.reply_text(subject, result["text"])
                delivered(result, subject, route)
    finally:
        await manager.stop()


if __name__ == "__main__":
    try:
        config = json.loads(sys.stdin.readline())
        asyncio.run(login() if "--login" in sys.argv else run_channel(config))
    except Exception:
        emit("error", message="微信连接失败，请检查网络或重新扫码")
        sys.exit(1)
