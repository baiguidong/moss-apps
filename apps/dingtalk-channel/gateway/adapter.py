import asyncio
import httpx
import dingtalk_registration
from moss_gateway.channels.dingtalk import DingTalkChannel, DingTalkConfig

Channel = DingTalkChannel
kind = "dingtalk"


def settings(config):
    return DingTalkConfig.from_dict({"client_id": config["accountId"], "client_secret": config["token"]})


def connected(channel):
    socket = getattr(channel._stream_client, "websocket", None)
    return bool(socket and socket.state.name == "OPEN")


async def login(emit):
    try:
        flow = await dingtalk_registration.generate()
    except (httpx.HTTPError, RuntimeError, ValueError):
        emit("error", loginError="无法从钉钉获取二维码，请稍后重试")
        return
    emit("qr", url=flow["verification_uri_complete"], code=flow["user_code"])
    interval = max(1, int(flow.get("interval") or 3))
    retry_since = None
    loop = asyncio.get_running_loop()
    try:
        async with asyncio.timeout(int(flow.get("expires_in") or 7200)):
            while True:
                await asyncio.sleep(interval)
                try:
                    result = await dingtalk_registration.poll(flow["device_code"])
                except (httpx.HTTPError, RuntimeError, ValueError):
                    reason = "暂时无法从钉钉获取授权结果，请检查网络后重试"
                else:
                    status = str(result.get("status") or "").strip().upper()
                    if status == "WAITING":
                        retry_since = None
                        continue
                    if status == "SUCCESS":
                        account, token = result.get("client_id"), result.get("client_secret")
                        if all(isinstance(v, str) and v.strip() for v in (account, token)):
                            emit("confirmed", accountId=account.strip(), token=token.strip())
                            return
                        reason = "钉钉已确认授权，但尚未返回完整的 Client ID 和 Client Secret"
                    elif status == "FAIL":
                        detail = result.get("fail_reason")
                        reason = "钉钉授权失败" + (f"：{detail[:240]}" if isinstance(detail, str) and detail else "，请在手机钉钉查看授权结果")
                    elif status == "EXPIRED":
                        reason = "钉钉二维码已过期，请重新生成"
                    else:
                        reason = "钉钉尚未返回可识别的授权结果，请重新扫码"

                # The DingTalk connector allows two minutes for a transient
                # failure during provisioning to settle on the same device code.
                if retry_since is None:
                    retry_since = loop.time()
                if loop.time() - retry_since >= 120:
                    emit("error", loginError=reason)
                    return
    except TimeoutError:
        emit("error", loginError="钉钉二维码已过期，请重新生成")
