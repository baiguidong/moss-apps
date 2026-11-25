from moss_gateway.channels.qq import QQBotQRLogin, QQChannel, QQConfig

kind = "qq"


class Channel(QQChannel):
    ready = False

    async def _handle_op(self, ws, op, payload):
        await super()._handle_op(ws, op, payload)
        if payload.get("t") in ("READY", "RESUMED"):
            self.ready = True

    async def _handle_ws_lifecycle(self, ws):
        try:
            await super()._handle_ws_lifecycle(ws)
        finally:
            self.ready = False


def settings(config):
    group = config.get("groupContext", {})
    return QQConfig.from_dict({
        "app_id": config["accountId"], "secret": config["token"], "c2c_streaming": config.get("responseMode") != "invoke",
        "group_context": {**group, "history": "none" if group.get("visibility") == "mention_only" else "recent"},
    })


def connected(channel):
    return channel.ready


async def login(emit):
    flow = QQBotQRLogin(source="moss")
    code = await flow.fetch_qr_code()
    emit("qr", url=code.qrcode_url)
    result = await flow.wait_for_login(code.task_id)
    if not result.connected or not result.credentials:
        raise ValueError("QR expired")
    bot = result.credentials[0]
    emit("confirmed", accountId=bot.app_id, token=bot.app_secret)
