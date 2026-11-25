import asyncio
import httpx
from moss_gateway.channels.wecom import WeComChannel, WeComConfig
from qr_bind import wecom_qr_generate, wecom_qr_poll

Channel = WeComChannel
kind = "wecom"


def settings(config):
    return WeComConfig.from_dict({
        "bot_id": config["accountId"], "secret": config["token"], "ws_url": config.get("websocketUrl", ""),
    })


def connected(channel):
    return channel._connected


async def login(emit):
    code = await wecom_qr_generate()
    emit("qr", url=code["auth_url"])
    async with asyncio.timeout(480):
        while True:
            await asyncio.sleep(2)
            try:
                result = await wecom_qr_poll(code["scode"])
            except httpx.TransportError:
                continue
            if result["status"] == "success":
                emit("confirmed", accountId=result["bot_id"], token=result["secret"])
                return
            if result["status"] in ("error", "expired", "failed"):
                raise ValueError("QR rejected")
