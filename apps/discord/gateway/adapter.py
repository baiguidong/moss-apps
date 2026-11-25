from urllib.parse import urlsplit
from urllib.request import getproxies, proxy_bypass

from moss_gateway.channels.discord import DiscordChannel, DiscordConfig

Channel = DiscordChannel
kind = "discord"


def settings(config):
    proxy = config.get("httpProxy") or ""
    if not proxy and not proxy_bypass("discord.com"):
        proxies = getproxies()
        candidate = proxies.get("https") or proxies.get("http") or proxies.get("all") or ""
        if urlsplit(candidate).scheme in ("http", "https"):
            proxy = candidate
    return DiscordConfig.from_dict({
        "bot_token": config["token"], "http_proxy": proxy,
        "http_proxy_auth": config.get("proxyAuth", ""), "allowed_user_ids": config.get("allowedUserIds", []),
        "allow_all_channels": config.get("allowAllChannels", True), "allowed_channel_ids": config.get("allowedChannelIds", []),
    })


def connected(channel):
    return channel.is_connected


def startup_error(error):
    return {
        "discord_invalid_token": "Discord 拒绝了 Bot Token，请在开发者平台检查或重置 Token。",
        "discord_intents_required": "请在 Discord Developer Portal 的 Bot 设置中启用 Message Content Intent。",
        "discord_proxy_auth_invalid": "代理认证格式应为 user:password。",
        "discord_connect_timeout": "连接 Discord 超时，请检查网络和 HTTP 代理设置。",
    }.get(str(error), "无法连接 Discord，请检查网络和 HTTP 代理设置。")
