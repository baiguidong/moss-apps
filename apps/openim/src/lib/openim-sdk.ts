import { getWithRenderProcess } from "@openim/electron-client-sdk/lib/render";
import { LoginStatus } from "@openim/wasm-client-sdk";
import { invokeOpenIMSdk, type OpenIMProfile } from "./host";

const { instance, subscribeCallback } = getWithRenderProcess({
  invoke: (method: string, ...args: unknown[]) => invokeOpenIMSdk(method, ...args),
});

window.mossApp.events.on("sdk.event", (payload: any) => {
  const event = typeof payload?.event === "string" ? payload.event : "";
  if (event) subscribeCallback(event as any, payload?.data);
});

export type { OpenIMProfile } from "./host";
export const openIMSDK = instance;

let activeUserID = "";

export async function ensureOpenIMSession(profile: OpenIMProfile) {
  const status = await openIMSDK.getLoginStatus();
  if (status.data !== LoginStatus.Logged && status.data !== LoginStatus.Logging) {
    throw new Error("OpenIM SDK is not logged in.");
  }
  const self = await openIMSDK.getSelfUserInfo();
  if (self.data.userID !== profile.userID) throw new Error("OpenIM account does not match the Moss account.");
  activeUserID = profile.userID;
  return { connected: status.data === LoginStatus.Logged, selfInfo: self.data };
}

export async function logoutOpenIMSession() {
  try {
    if (activeUserID) await openIMSDK.logout();
  } finally {
    activeUserID = "";
  }
}
