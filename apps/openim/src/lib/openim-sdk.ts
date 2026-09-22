import { getWithRenderProcess } from "@openim/electron-client-sdk/lib/render";
import { LogLevel, LoginStatus } from "@openim/wasm-client-sdk";

export type OpenIMProfile = {
  userID: string;
  imToken: string;
  chatToken?: string;
  expiresIn: number;
  apiAddr: string;
  wsAddr: string;
  rtcEnabled: boolean;
  capabilities: { createGroup: boolean };
  user: {
    id: string;
    name: string;
    email: string | null;
    orgId: string;
  };
};

export type OpenIMSDKConfig = Awaited<ReturnType<typeof window.agentDesktop.openIM.getConfig>> & {
  apiAddr: string;
  wsAddr: string;
};

const { instance } = getWithRenderProcess();

export const openIMSDK = instance;

let initialization: Promise<void> | null = null;
let activeUserID = "";

async function initializeSDK(config: OpenIMSDKConfig) {
  if (!initialization) {
    initialization = (async () => {
      const currentStatus = await openIMSDK.getLoginStatus().catch(() => null);
      if (currentStatus?.data === LoginStatus.Logged || currentStatus?.data === LoginStatus.Logging) {
        return;
      }
      const initialized = await openIMSDK.initSDK({
        platformID: config.platformID,
        apiAddr: config.apiAddr,
        wsAddr: config.wsAddr,
        dataDir: config.dataDir,
        logFilePath: config.logFilePath,
        logLevel: LogLevel.Info,
        isLogStandardOutput: false,
        systemType: "electron",
      });
      if (initialized) return;
      const status = await openIMSDK.getLoginStatus();
      if (status.data !== LoginStatus.Logged && status.data !== LoginStatus.Logging) {
        throw new Error("OpenIM SDK 初始化失败");
      }
    })().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
}

export async function ensureOpenIMSession(profile: OpenIMProfile, config: OpenIMSDKConfig) {
  await initializeSDK(config);
  const status = await openIMSDK.getLoginStatus();
  if (status.data === LoginStatus.Logged || status.data === LoginStatus.Logging) {
    const self = await openIMSDK.getSelfUserInfo();
    if (self.data.userID === profile.userID) {
      activeUserID = profile.userID;
      return {
        connected: status.data === LoginStatus.Logged,
        selfInfo: self.data,
      };
    }
    await openIMSDK.logout();
  }
  await openIMSDK.login({ userID: profile.userID, token: profile.imToken });
  activeUserID = profile.userID;
  return {
    connected: true,
    selfInfo: (await openIMSDK.getSelfUserInfo()).data,
  };
}

export async function logoutOpenIMSession() {
  try {
    const status = await openIMSDK.getLoginStatus();
    if (status.data === LoginStatus.Logged || status.data === LoginStatus.Logging || activeUserID) {
      await openIMSDK.logout();
    }
  } finally {
    activeUserID = "";
  }
}
