import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenIMSDK from "@openim/node-client-sdk";
import type { AppBackendClient, AppBackendContext } from "@moss/app-sdk";
import { openIMDirectConversationId, parseOpenIMDirectConversationId } from "../lib/conversation-identifiers";

const AUTOMATION_MESSAGE_EXTENSION = "moss.openim/automation-v1";
const SESSION_REFRESH_MIN_LEAD_MS = 10_000;
const SESSION_REFRESH_MAX_LEAD_MS = 60_000;
const DIRECT_SESSION_TYPE = 1;
const TEXT_CONTENT_TYPES = new Set([101, 106, 114]);
const RECEIVE_EVENTS = new Set(["OnRecvNewMessage", "OnRecvNewMessages"]);
const SESSION_EVENTS = new Set([
  "OnConnecting",
  "OnConnectSuccess",
  "OnConnectFailed",
  "OnKickedOffline",
  "OnUserTokenExpired",
  "OnUserTokenInvalid",
]);
const SDK_METHODS = new Set([
  "getLoginStatus",
  "getSelfUserInfo",
  "logout",
  "networkStatusChanged",
  "getAllConversationList",
  "getOneConversation",
  "getGroupMemberList",
  "getAdvancedHistoryMessageList",
  "searchLocalMessages",
  "createTextMessage",
  "createTextAtMessage",
  "createQuoteMessage",
  "createForwardMessage",
  "createMergerMessage",
  "createCardMessage",
  "createLocationMessage",
  "createCustomMessage",
  "createImageMessageFromFullPath",
  "createVideoMessageFromFullPath",
  "createSoundMessageFromFullPath",
  "createFileMessageFromFullPath",
  "sendMessage",
  "markConversationMessageAsRead",
  "revokeMessage",
  "deleteMessageFromLocalStorage",
  "clearConversationAndDeleteAllMsg",
  "deleteConversationAndDeleteAllMsg",
  "setConversation",
  "setConversationDraft",
  "typingStatusUpdate",
  "createGroup",
  "inviteUserToGroup",
  "kickGroupMember",
  "setGroupInfo",
]);

type RemoteProfile = {
  userID: string;
  imToken: string;
  expiresIn: number;
  apiAddr: string;
  wsAddr: string;
  rtcEnabled: boolean;
  capabilities: { createGroup: boolean };
  user: { id: string; name: string; email: string | null; orgId: string };
};

export type PublicOpenIMProfile = Omit<RemoteProfile, "imToken" | "apiAddr" | "wsAddr">;

export type OpenIMAutomationMessage = {
  externalUserId: string;
  externalConversationId: string;
  externalEventId: string;
  text: string;
  sentAt: number;
  contentType: number;
  sessionType: number;
  extension?: string;
};

type EventListener = (event: string, data: any) => void | Promise<void>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return String(value.errDlt || value.errMsg || value.message || "OpenIM request failed");
  }
  return String(error || "OpenIM request failed");
}

function platformId(): number {
  if (process.platform === "darwin") return 4;
  if (process.platform === "win32") return 3;
  return 7;
}

function nativeLibraryPath(): string {
  const folder = process.platform === "darwin"
    ? `mac_${process.arch}`
    : process.platform === "win32"
      ? `win_${process.arch}`
      : `linux_${process.arch}`;
  const fileName = process.platform === "darwin"
    ? "libopenimsdk.dylib"
    : process.platform === "win32"
      ? "libopenimsdk.dll"
      : "libopenimsdk.so";
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "native", folder, fileName);
}

function eventData(value: any): any {
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "data")
    ? value.data
    : value;
}

function eventItems(value: any): Array<Record<string, any>> {
  const data = eventData(value);
  return (Array.isArray(data) ? data : [data]).filter(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );
}

function messageText(message: Record<string, any>): string {
  const contentType = Number(message.contentType);
  if (!TEXT_CONTENT_TYPES.has(contentType)) return "";
  if (contentType === 101) return text(message.textElem?.content);
  if (contentType === 106) return text(message.atTextElem?.text);
  return text(message.quoteElem?.text);
}

function timestamp(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now();
  return parsed < 1_000_000_000_000 ? parsed * 1_000 : parsed;
}

function deterministicMessageId(idempotencyKey: string): string {
  const hash = createHash("sha256").update(idempotencyKey).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function publicProfile(profile: RemoteProfile, expiresAt: number): PublicOpenIMProfile {
  const { imToken: _imToken, apiAddr: _apiAddr, wsAddr: _wsAddr, ...safe } = profile;
  return { ...safe, expiresIn: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1_000)) };
}

export function normalizeOpenIMMessages(event: string, value: unknown, currentUserId: string): OpenIMAutomationMessage[] {
  if (!RECEIVE_EVENTS.has(event) || !currentUserId) return [];
  return eventItems(value).flatMap((message) => {
    const externalUserId = text(message.sendID);
    const recipientUserId = text(message.recvID);
    const externalEventId = text(message.serverMsgID) || text(message.clientMsgID);
    const body = messageText(message);
    if (
      Number(message.sessionType) !== DIRECT_SESSION_TYPE
      || !externalUserId
      || externalUserId === currentUserId
      || recipientUserId !== currentUserId
      || !externalEventId
      || !body
    ) return [];
    return [{
      externalUserId,
      externalConversationId: openIMDirectConversationId(currentUserId, externalUserId),
      externalEventId,
      text: body.slice(0, 100_000),
      sentAt: timestamp(message.sendTime || message.createTime),
      contentType: Number(message.contentType),
      sessionType: Number(message.sessionType),
      ...(text(message.ex) ? { extension: text(message.ex).slice(0, 1_024) } : {}),
    }];
  });
}

export function normalizeOpenIMSessionEvent(event: string, value: unknown, currentUserId: string) {
  if (!SESSION_EVENTS.has(event)) return null;
  const payload = eventData(value);
  if (event === "OnConnectSuccess") return { connected: true, userId: currentUserId };
  if (event === "OnConnecting") return { connected: false, userId: currentUserId };
  const error = text(payload?.errMsg || payload?.message)
    || (event === "OnKickedOffline"
      ? "OpenIM account was signed in elsewhere."
      : event.includes("Token")
        ? "OpenIM session expired."
        : "OpenIM connection failed.");
  return { connected: false, userId: currentUserId, error };
}

export function createOpenIMClientService(client: Pick<AppBackendClient, "host" | "emit" | "log" | "status">) {
  let context: AppBackendContext | null = null;
  let sdk: OpenIMSDK | null = null;
  let sdkInitialized = false;
  let activeProfile: RemoteProfile | null = null;
  let activeExpiresAt = 0;
  let sessionPromise: Promise<PublicOpenIMProfile> | null = null;
  const listeners = new Set<EventListener>();
  const sentMessages = new Map<string, Record<string, unknown>>();
  const pendingSends = new Map<string, Promise<Record<string, unknown>>>();
  let sentMessagesPath = "";

  function requireDesktopContext(): AppBackendContext {
    if (!context || context.target.type !== "desktop") throw new Error("This OpenIM action requires the Desktop backend.");
    return context;
  }

  function ensureDirectories() {
    const current = requireDesktopContext();
    for (const directory of ["sdk", "logs", "platform-files"]) {
      fs.mkdirSync(path.join(current.dataDir, directory), { recursive: true, mode: 0o700 });
    }
  }

  function loadSentMessages() {
    sentMessages.clear();
    try {
      const entries = JSON.parse(fs.readFileSync(sentMessagesPath, "utf8"));
      if (Array.isArray(entries)) {
        for (const [key, value] of entries.slice(-1_000)) {
          if (typeof key === "string" && value && typeof value === "object") sentMessages.set(key, value);
        }
      }
    } catch {}
  }

  function persistSentMessages() {
    const temporary = `${sentMessagesPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify([...sentMessages]), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, sentMessagesPath);
  }

  function clearSession() {
    activeProfile = null;
    activeExpiresAt = 0;
  }

  function dispatchNativeEvent(event: unknown, data: unknown) {
    const name = text(event);
    if (!name) return;
    client.emit("sdk.event", { event: name, data });
    const sessionEvent = normalizeOpenIMSessionEvent(name, data, text(activeProfile?.userID));
    if (sessionEvent) {
      client.emit("openim.session-changed", sessionEvent);
      client.status(sessionEvent.connected ? "running" : "degraded", sessionEvent);
    }
    for (const listener of listeners) {
      try {
        Promise.resolve(listener(name, data)).catch((error) => {
          client.log("warn", "OpenIM event listener failed", { event: name, error: errorMessage(error) });
        });
      } catch (error) {
        client.log("warn", "OpenIM event listener failed", { event: name, error: errorMessage(error) });
      }
    }
  }

  function ensureSdk(): OpenIMSDK {
    requireDesktopContext();
    if (sdk) return sdk;
    const libraryPath = nativeLibraryPath();
    if (!fs.existsSync(libraryPath)) throw new Error(`OpenIM native library is missing for ${process.platform}-${process.arch}.`);
    sdk = new OpenIMSDK(libraryPath, (event: unknown, data: unknown) => dispatchNativeEvent(event, data));
    return sdk;
  }

  function refreshLeadMs(): number {
    const lifetimeMs = Math.max(0, Number(activeProfile?.expiresIn) || 0) * 1_000;
    return Math.min(SESSION_REFRESH_MAX_LEAD_MS, Math.max(SESSION_REFRESH_MIN_LEAD_MS, lifetimeMs * 0.1));
  }

  async function issueProfile(): Promise<RemoteProfile> {
    return client.host.request<RemoteProfile>(
      "moss.openim/v1",
      "session.issue",
      { platformId: platformId() },
      { timeoutMs: 35_000 },
    );
  }

  async function ensureSession(): Promise<PublicOpenIMProfile> {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      ensureDirectories();
      const currentSdk = ensureSdk();
      if (activeProfile && activeExpiresAt > Date.now() + refreshLeadMs()) {
        const status = await currentSdk.getLoginStatus().catch(() => null);
        if (Number(status?.data) === 3) {
          const self = await currentSdk.getSelfUserInfo();
          if (text(self.data?.userID) === activeProfile.userID) return publicProfile(activeProfile, activeExpiresAt);
        }
      }

      const profile = await issueProfile();
      if (!profile?.userID || !profile.imToken || !profile.apiAddr || !profile.wsAddr) {
        throw new Error("OpenIM Server returned an incomplete session profile.");
      }
      if (!sdkInitialized) {
        const current = requireDesktopContext();
        const initialized = await currentSdk.initSDK({
          platformID: platformId(),
          apiAddr: profile.apiAddr,
          wsAddr: profile.wsAddr,
          dataDir: path.join(current.dataDir, "sdk"),
          logFilePath: path.join(current.dataDir, "logs"),
          logLevel: 4,
          isLogStandardOutput: false,
        });
        if (!initialized) {
          const status = await currentSdk.getLoginStatus();
          if (![2, 3].includes(Number(status.data))) throw new Error("OpenIM SDK initialization failed.");
        }
        sdkInitialized = true;
      }

      const status = await currentSdk.getLoginStatus();
      const currentUserID = Number(status.data) === 3
        ? text((await currentSdk.getSelfUserInfo()).data?.userID)
        : "";
      if (Number(status.data) !== 3 || currentUserID !== profile.userID || activeProfile?.imToken !== profile.imToken) {
        if ([2, 3].includes(Number(status.data))) await currentSdk.logout().catch(() => {});
        await currentSdk.login({ userID: profile.userID, token: profile.imToken });
      }
      activeProfile = profile;
      activeExpiresAt = Date.now() + Math.max(60, Number(profile.expiresIn) || 3_600) * 1_000;
      const result = publicProfile(profile, activeExpiresAt);
      client.status("running", { connected: true, userId: profile.userID });
      client.emit("openim.session-changed", { connected: true, userId: profile.userID, expiresIn: result.expiresIn });
      return result;
    })().catch((error) => {
      clearSession();
      client.status("degraded", { error: errorMessage(error) });
      throw error;
    }).finally(() => {
      sessionPromise = null;
    });
    return sessionPromise;
  }

  function allowedFile(filePath: unknown): string {
    const current = requireDesktopContext();
    const root = fs.realpathSync(path.join(current.dataDir, "platform-files"));
    const resolved = fs.realpathSync(path.resolve(String(filePath || "")));
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(resolved).isFile()) {
      throw new Error("OpenIM can only read files selected through the Desktop Host.");
    }
    return resolved;
  }

  function safeArguments(method: string, args: unknown[]): unknown[] {
    if (method === "createImageMessageFromFullPath") return [allowedFile(args[0]), ...args.slice(1)];
    const source = args[0] && typeof args[0] === "object" && !Array.isArray(args[0])
      ? args[0] as Record<string, unknown>
      : {};
    if (method === "createVideoMessageFromFullPath") {
      return [{ ...source, videoPath: allowedFile(source.videoPath), snapshotPath: allowedFile(source.snapshotPath) }, ...args.slice(1)];
    }
    if (method === "createSoundMessageFromFullPath") {
      return [{ ...source, soundPath: allowedFile(source.soundPath) }, ...args.slice(1)];
    }
    if (method === "createFileMessageFromFullPath") {
      return [{ ...source, filePath: allowedFile(source.filePath) }, ...args.slice(1)];
    }
    return args;
  }

  async function setConversation(input: Record<string, unknown>) {
    const currentSdk = ensureSdk();
    const conversationID = text(input.conversationID);
    if (!conversationID) throw new Error("Conversation ID is required.");
    const results = [];
    if (typeof input.isPinned === "boolean") {
      results.push(await currentSdk.pinConversation({ conversationID, isPinned: input.isPinned } as any));
    }
    if (Number.isInteger(input.recvMsgOpt)) {
      results.push(await currentSdk.setConversationRecvMessageOpt({ conversationID, recvMsgOpt: input.recvMsgOpt } as any));
    }
    return results.at(-1) || { errCode: 0, errMsg: "", data: null };
  }

  async function call(methodValue: unknown, argsValue: unknown) {
    const method = text(methodValue);
    if (!SDK_METHODS.has(method)) throw new Error(`OpenIM SDK method is not available to the App UI: ${method || "<empty>"}.`);
    const args = Array.isArray(argsValue) ? argsValue : [];
    if (method !== "getLoginStatus" && method !== "logout") await ensureSession();
    if (method === "setConversation") return setConversation((args[0] || {}) as Record<string, unknown>);
    const currentSdk = ensureSdk() as unknown as Record<string, (...values: any[]) => Promise<any>>;
    const target = currentSdk[method];
    if (typeof target !== "function") throw new Error(`OpenIM SDK method is unavailable: ${method}.`);
    const result = await target.apply(currentSdk, safeArguments(method, args));
    if (method === "logout") clearSession();
    return result;
  }

  async function sendText(input: {
    recipientId: string;
    conversationId: string;
    text: string;
    idempotencyKey: string;
    extension?: string;
  }): Promise<Record<string, unknown>> {
    const idempotencyKey = text(input.idempotencyKey);
    const existing = sentMessages.get(idempotencyKey);
    if (existing) return { ...existing, duplicate: true };
    const pending = pendingSends.get(idempotencyKey);
    if (pending) return pending;
    const operation = (async () => {
      const profile = await ensureSession();
      const conversation = parseOpenIMDirectConversationId(input.conversationId);
      if (!conversation || conversation.userId !== profile.userID || conversation.peerUserId !== input.recipientId) {
        throw new Error("OpenIM conversation does not belong to the active account.");
      }
      const currentSdk = ensureSdk();
      const created = await currentSdk.createTextMessage(input.text);
      const message = {
        ...(created.data as Record<string, unknown>),
        clientMsgID: deterministicMessageId(idempotencyKey),
        ...(input.extension ? { ex: input.extension } : {}),
      };
      const sent = await currentSdk.sendMessage({ recvID: input.recipientId, groupID: "", message } as any);
      const result = {
        sent: true,
        conversationId: input.conversationId,
        clientMessageId: text((sent.data as any)?.clientMsgID) || String(message.clientMsgID),
        serverMessageId: text((sent.data as any)?.serverMsgID),
      };
      sentMessages.set(idempotencyKey, result);
      while (sentMessages.size > 1_000) sentMessages.delete(sentMessages.keys().next().value!);
      try { persistSentMessages(); } catch (error) {
        client.log("warn", "Unable to persist OpenIM delivery receipt", { error: errorMessage(error) });
      }
      return result;
    })().finally(() => pendingSends.delete(idempotencyKey));
    pendingSends.set(idempotencyKey, operation);
    return operation;
  }

  async function markConversationRead(conversationId: string) {
    const profile = await ensureSession();
    const conversation = parseOpenIMDirectConversationId(conversationId);
    if (!conversation || conversation.userId !== profile.userID) {
      throw new Error("OpenIM conversation does not belong to the active account.");
    }
    const currentSdk = ensureSdk();
    const result = await currentSdk.getOneConversation({ sourceID: conversation.peerUserId, sessionType: DIRECT_SESSION_TYPE });
    const sdkConversationId = text(result.data?.conversationID);
    if (!sdkConversationId) throw new Error("OpenIM conversation is unavailable.");
    await currentSdk.markConversationMessageAsRead(sdkConversationId);
    return { read: true, conversationId };
  }

  return {
    initialize(nextContext: AppBackendContext) {
      if (nextContext.target.type !== "desktop") throw new Error("OpenIM native client can only run on Desktop.");
      context = nextContext;
      ensureDirectories();
      sentMessagesPath = path.join(nextContext.dataDir, "sent-messages.json");
      loadSentMessages();
    },

    async shutdown() {
      sessionPromise = null;
      pendingSends.clear();
      if (sdk) {
        await sdk.logout().catch(() => {});
        await sdk.unInitSDK().catch(() => {});
      }
      sdk = null;
      sdkInitialized = false;
      clearSession();
      context = null;
    },

    getStatus() {
      return {
        available: Boolean(context),
        platformID: platformId(),
        connected: Boolean(activeProfile),
        userId: text(activeProfile?.userID),
        expiresIn: activeProfile ? publicProfile(activeProfile, activeExpiresAt).expiresIn : 0,
      };
    },

    ensureSession,
    call,
    sendText,
    markConversationRead,
    normalizeMessages(event: string, data: unknown) {
      return normalizeOpenIMMessages(event, data, text(activeProfile?.userID));
    },
    normalizeSessionEvent(event: string, data: unknown) {
      return normalizeOpenIMSessionEvent(event, data, text(activeProfile?.userID));
    },
    onEvent(listener: EventListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    automationExtension: AUTOMATION_MESSAGE_EXTENSION,
  };
}
