from moss_gateway.channels.telegram import TelegramChannel, TelegramConfig

Channel = TelegramChannel
kind = "telegram"


def settings(config):
    return TelegramConfig.from_dict({
        "bot_token": config["token"], "http_proxy": config.get("httpProxy", ""),
        "allowed_user_ids": config.get("allowedUserIds", []),
        "show_typing": config.get("responseMode") != "invoke",
    })


def connected(channel):
    return bool(channel._app and channel._app.updater and channel._app.updater.running)
