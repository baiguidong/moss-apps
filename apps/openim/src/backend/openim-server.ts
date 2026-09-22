import { createHash, randomUUID } from "node:crypto";
import type {
  AccountDirectoryUser,
  AccountHostResultMap,
  AppBackendClient,
  AppBackendContext,
} from "@moss/app-sdk";

type OpenIMResponse<T> = {
  errCode?: number;
  errMsg?: string;
  errDlt?: string;
  data?: T;
};

type OpenIMServerConfig = {
  apiUrl: string;
  wsUrl: string;
  namespace: string;
  adminUserId: string;
  secret: string;
  requestTimeoutMs: number;
};

type AccountIdentity = AccountHostResultMap["identity.current"];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "OpenIM request failed");
}

function normalizeHttpUrl(value: unknown): string {
  const normalized = text(value).replace(/\/+$/, "");
  if (normalized && !/^https?:\/\//i.test(normalized)) throw new Error("OpenIM API URL must use HTTP or HTTPS.");
  return normalized;
}

function normalizeWebSocketUrl(value: unknown): string {
  const normalized = text(value).replace(/\/+$/, "");
  if (normalized && !/^wss?:\/\//i.test(normalized)) throw new Error("OpenIM WebSocket URL must use WS or WSS.");
  return normalized;
}

export function openIMUserId(namespace: string, orgId: string, userId: string): string {
  const digest = createHash("sha256")
    .update(`${namespace}\0${orgId}\0${userId}`)
    .digest("hex")
    .slice(0, 32);
  return `moss_${digest}`;
}

function serverConfig(context: AppBackendContext): OpenIMServerConfig {
  const config = context.config || {};
  const secrets = context.secrets || {};
  const requestTimeoutMs = Math.min(60_000, Math.max(1_000, Number(config.requestTimeoutMs) || 15_000));
  return {
    apiUrl: normalizeHttpUrl(config.apiUrl),
    wsUrl: normalizeWebSocketUrl(config.wsUrl),
    namespace: text(config.namespace) || context.instanceId,
    adminUserId: text(config.adminUserId) || "imAdmin",
    secret: text(secrets.secret),
    requestTimeoutMs,
  };
}

export function createOpenIMServerService(client: Pick<AppBackendClient, "account" | "log" | "status">) {
  let context: AppBackendContext | null = null;
  let config: OpenIMServerConfig | null = null;
  let adminToken: { value: string; expiresAt: number } | null = null;
  let unsubscribeDirectoryUserChanged: (() => void) | null = null;
  const pendingProvisioning = new Map<string, Promise<string>>();

  function requireContext(): AppBackendContext {
    if (!context || context.target.type !== "server") throw new Error("This OpenIM action requires the Server backend.");
    return context;
  }

  function requireConfig(): OpenIMServerConfig {
    requireContext();
    if (!config?.apiUrl || !config.wsUrl || !config.secret) {
      throw new Error("OpenIM Server is not configured for this App instance.");
    }
    return config;
  }

  async function post<T>(pathname: string, body: Record<string, unknown>, token?: string): Promise<T> {
    const current = requireConfig();
    let response: Response;
    try {
      response = await fetch(`${current.apiUrl}${pathname}`, {
        method: "POST",
        signal: AbortSignal.timeout(current.requestTimeoutMs),
        headers: {
          "content-type": "application/json; charset=utf-8",
          operationID: randomUUID(),
          ...(token ? { token } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Unable to connect to OpenIM: ${errorMessage(error)}`);
    }

    let payload: OpenIMResponse<T>;
    try {
      payload = await response.json() as OpenIMResponse<T>;
    } catch {
      throw new Error(`OpenIM returned an invalid response (${response.status}).`);
    }
    if (!response.ok || payload.errCode !== 0) {
      throw new Error(`OpenIM request failed: ${payload.errDlt || payload.errMsg || `${response.status} ${response.statusText}`}`);
    }
    return payload.data as T;
  }

  async function getAdminToken(force = false): Promise<string> {
    const current = requireConfig();
    if (!force && adminToken && adminToken.expiresAt > Date.now() + 60_000) return adminToken.value;
    const data = await post<{ token?: string; expireTimeSeconds?: number }>("/auth/get_admin_token", {
      secret: current.secret,
      userID: current.adminUserId,
    });
    const value = text(data?.token);
    if (!value) throw new Error("OpenIM did not return an administrator token.");
    const expiresIn = Math.max(60, Number(data.expireTimeSeconds) || 3_600);
    adminToken = { value, expiresAt: Date.now() + expiresIn * 1_000 };
    return value;
  }

  async function adminPost<T>(pathname: string, body: Record<string, unknown>): Promise<T> {
    try {
      return await post<T>(pathname, body, await getAdminToken());
    } catch (error) {
      if (!/token/i.test(errorMessage(error))) throw error;
      adminToken = null;
      return post<T>(pathname, body, await getAdminToken(true));
    }
  }

  async function identity(): Promise<AccountIdentity> {
    const result = await client.account.request("identity.current", {});
    if (!result.user || result.user.status !== "active" || !result.organization?.id) {
      throw new Error("The OpenIM App requires an active Moss Server user and organization.");
    }
    return result;
  }

  async function provision(user: AccountDirectoryUser, identityValue: AccountIdentity): Promise<string> {
    const current = requireConfig();
    const orgId = String(identityValue.organization!.id);
    const userID = openIMUserId(current.namespace, orgId, user.id);
    const existing = pendingProvisioning.get(userID);
    if (existing) return existing;
    const operation = (async () => {
      const checked = await adminPost<{ results?: Array<{ userID?: string; accountStatus?: number }> }>(
        "/user/account_check",
        { checkUserIDs: [userID] },
      );
      const registered = checked?.results?.some((item) => item.userID === userID && item.accountStatus === 1);
      const userInfo = {
        userID,
        nickname: user.name || user.id,
        faceURL: "",
        ex: JSON.stringify({ mossOrgId: orgId, mossUserId: user.id }),
      };
      if (registered) {
        await adminPost("/user/update_user_info", { userInfo });
      } else {
        try {
          await adminPost("/user/user_register", { users: [userInfo] });
        } catch (error) {
          const retried = await adminPost<{ results?: Array<{ userID?: string; accountStatus?: number }> }>(
            "/user/account_check",
            { checkUserIDs: [userID] },
          );
          if (!retried?.results?.some((item) => item.userID === userID && item.accountStatus === 1)) throw error;
          await adminPost("/user/update_user_info", { userInfo });
        }
      }
      return userID;
    })().finally(() => pendingProvisioning.delete(userID));
    pendingProvisioning.set(userID, operation);
    return operation;
  }

  async function findDirectoryUser(userId: string) {
    const currentIdentity = await identity();
    const directory = await client.account.request("directory.search", { query: userId, limit: 200 });
    const user = directory.users.find((entry) => entry.id === userId && entry.status === "active");
    if (!user) throw new Error("The selected Moss directory user is unavailable.");
    return { identity: currentIdentity, user };
  }

  async function findDirectoryUsers(userIds: string[]): Promise<AccountDirectoryUser[]> {
    const remaining = new Set(userIds);
    const found = new Map<string, AccountDirectoryUser>();
    let cursor: string | undefined;
    do {
      const page = await client.account.request("directory.list", { limit: 200, ...(cursor ? { cursor } : {}) });
      for (const user of page.users) {
        if (remaining.has(user.id) && user.status === "active") {
          found.set(user.id, user);
          remaining.delete(user.id);
        }
      }
      cursor = text(page.nextCursor) || undefined;
    } while (cursor && remaining.size);
    return userIds.map((userId) => {
      const user = found.get(userId);
      if (!user) throw new Error(`Moss directory user is unavailable: ${userId}`);
      return user;
    });
  }

  async function revokeUser(userId: string): Promise<void> {
    if (!config?.secret || !context?.owner?.orgId) return;
    const userID = openIMUserId(config.namespace, context.owner.orgId, userId);
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => adminPost(
      "/auth/force_logout",
      { platformID: index + 1, userID },
    )));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) throw new Error(`OpenIM session revocation failed (${failures.length}/8).`);
  }

  return {
    initialize(nextContext: AppBackendContext) {
      context = nextContext;
      config = serverConfig(nextContext);
      adminToken = null;
      unsubscribeDirectoryUserChanged?.();
      unsubscribeDirectoryUserChanged = client.account.on("directory.user-changed", async ({ user }) => {
        if (user.status === "disabled") await revokeUser(user.id);
      });
      if (!config.apiUrl || !config.wsUrl || !config.secret) {
        client.status("degraded", { error: "OpenIM Server configuration is incomplete." });
      } else {
        client.status("running", { configured: true });
      }
    },

    shutdown() {
      context = null;
      config = null;
      adminToken = null;
      pendingProvisioning.clear();
      unsubscribeDirectoryUserChanged?.();
      unsubscribeDirectoryUserChanged = null;
    },

    async health() {
      const current = requireConfig();
      await getAdminToken();
      return { configured: true, connected: true, namespace: current.namespace };
    },

    async issueSession(input: { platformId?: unknown } = {}) {
      const platformId = Math.floor(Number(input.platformId) || 0);
      if (![1, 2, 3, 4, 5, 6, 7, 8].includes(platformId)) throw new Error("Invalid OpenIM platform ID.");
      const current = requireConfig();
      const currentIdentity = await identity();
      const userID = await provision(currentIdentity.user!, currentIdentity);
      const token = await adminPost<{ token?: string; expireTimeSeconds?: number }>(
        "/auth/get_user_token",
        { platformID: platformId, userID },
      );
      const imToken = text(token?.token);
      if (!imToken) throw new Error("OpenIM did not return a user token.");
      return {
        userID,
        imToken,
        expiresIn: Math.max(60, Number(token.expireTimeSeconds) || 3_600),
        apiAddr: current.apiUrl,
        wsAddr: current.wsUrl,
        rtcEnabled: false,
        capabilities: { createGroup: true },
        user: {
          id: currentIdentity.user!.id,
          name: currentIdentity.user!.name,
          email: currentIdentity.user!.email || null,
          orgId: String(currentIdentity.organization!.id),
        },
      };
    },

    async listDirectory(input: { cursor?: unknown; limit?: unknown } = {}) {
      const current = requireConfig();
      const currentIdentity = await identity();
      const page = await client.account.request("directory.list", {
        limit: Math.min(200, Math.max(1, Number(input.limit) || 200)),
        ...(text(input.cursor) ? { cursor: text(input.cursor) } : {}),
      });
      const orgId = String(currentIdentity.organization!.id);
      return {
        departments: page.departments,
        users: page.users
          .filter((user) => user.status === "active")
          .map((user) => ({ ...user, status: "active", openimUserID: openIMUserId(current.namespace, orgId, user.id) })),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        ...(page.revision ? { revision: page.revision } : {}),
      };
    },

    async prepareDirect(input: { userId?: unknown } = {}) {
      const userId = text(input.userId);
      if (!userId) throw new Error("Select a contact first.");
      const directory = await findDirectoryUser(userId);
      if (directory.identity.user!.id === userId) throw new Error("A direct conversation cannot target the current user.");
      const userID = await provision(directory.user, directory.identity);
      return { userID, name: directory.user.name, email: directory.user.email || null };
    },

    async prepareGroup(input: { userIds?: unknown } = {}) {
      const currentIdentity = await identity();
      const userIds = Array.isArray(input.userIds)
        ? [...new Set(input.userIds.map(text).filter(Boolean))]
        : [];
      if (userIds.length < 2) throw new Error("Select at least two members to create a group.");
      if (userIds.includes(currentIdentity.user!.id)) throw new Error("Do not select the current user as a group member.");
      const users = await findDirectoryUsers(userIds);
      return {
        groupID: `moss_${randomUUID().replaceAll("-", "")}`,
        memberUserIDs: await Promise.all(users.map((user) => provision(user, currentIdentity))),
      };
    },
  };
}
