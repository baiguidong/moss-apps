export type OpenIMDirectory = {
  departments: Array<{
    id: string;
    orgId?: string;
    parentId: string | null;
    name: string;
    userCount: number;
  }>;
  users: Array<{
    id: string;
    name: string;
    email: string | null;
    departmentId: string | null;
    status: "active";
    openimUserID: string;
  }>;
  revision?: string;
  nextCursor?: string;
};

export type OpenIMLocalFile = {
  name: string;
  path: string;
  size: number;
  mediaUrl: string;
};

type OpenIMMaterializeResult = OpenIMLocalFile | { transferId: string; complete: false; size: number };

export type OpenIMProfile = {
  userID: string;
  chatToken?: string;
  expiresIn: number;
  rtcEnabled: boolean;
  capabilities: { createGroup: boolean };
  user: { id: string; name: string; email: string | null; orgId: string };
};

const DESKTOP_PROTOCOL = "moss.desktop/v1";
const MATERIALIZE_CHUNK_BYTES = 384 * 1024;
let instanceIdPromise: Promise<string> | null = null;

function bytesToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunkSize = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function resolveInstanceId(): Promise<string> {
  if (!instanceIdPromise) {
    instanceIdPromise = window.mossApp.instances.list().then((instances) => {
      const instance = instances.find((item) => item.enabled === true) || instances[0];
      if (!instance?.id) throw new Error("OpenIM App instance is unavailable.");
      return String(instance.id);
    }).catch((error) => {
      instanceIdPromise = null;
      throw error;
    });
  }
  return instanceIdPromise;
}

async function invoke<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  return window.mossApp.actions.invoke<T>(await resolveInstanceId(), name, input);
}

async function desktop<T>(method: string, input: Record<string, unknown> = {}): Promise<T> {
  return window.mossApp.host.request<T>(await resolveInstanceId(), DESKTOP_PROTOCOL, method, input);
}

export const openIMHost = {
  getConfig: () => invoke<{
    available: boolean;
    platformID: number;
    connected: boolean;
    userId: string;
    expiresIn: number;
  }>("status.get"),
  createSession: () => invoke<OpenIMProfile>("session.ensure"),
  listDirectory: (cursor?: string) => invoke<OpenIMDirectory>("directory.list", {
    limit: 200,
    ...(cursor ? { cursor } : {}),
  }),
  prepareDirectConversation: (payload: { userID: string }) => invoke<{
    userID: string;
    name: string;
    email: string | null;
  }>("conversation.direct.prepare", { userId: payload.userID }),
  prepareGroupConversation: (payload: { userIDs: string[] }) => invoke<{
    groupID: string;
    memberUserIDs: string[];
  }>("conversation.group.prepare", { userIds: payload.userIDs }),
  pickFiles: async (payload: { kind: "image" | "video" | "audio" | "file" }) => (
    await desktop<{ files: OpenIMLocalFile[] }>("file.pick", {
      kind: payload.kind,
      multiple: payload.kind === "file" || payload.kind === "image",
    })
  ).files,
  materializeFile: async (payload: { fileName: string; data: ArrayBuffer }): Promise<OpenIMLocalFile> => {
    const transferId = globalThis.crypto.randomUUID();
    let result: OpenIMMaterializeResult | null = null;
    for (let offset = 0; offset < payload.data.byteLength; offset += MATERIALIZE_CHUNK_BYTES) {
      const end = Math.min(payload.data.byteLength, offset + MATERIALIZE_CHUNK_BYTES);
      result = await desktop<OpenIMMaterializeResult>("file.materialize", {
        fileName: payload.fileName,
        dataBase64: bytesToBase64(payload.data.slice(offset, end)),
        transferId,
        offset,
        complete: end === payload.data.byteLength,
      });
    }
    if (!result || "complete" in result) throw new Error("File materialization did not complete.");
    return result;
  },
  createVideoThumbnail: (payload: { path: string }) => desktop<{ path: string; mediaUrl: string }>(
    "file.thumbnail",
    { path: payload.path, width: 640, height: 360 },
  ),
  captureScreen: () => desktop<OpenIMLocalFile>("screen.capture"),
  download: (payload: { url: string; fileName: string }) => desktop<{ canceled: boolean; filePath?: string }>(
    "file.download",
    payload,
  ),
  openExternal: (url: string) => desktop<{ opened: true }>("shell.open-external", { url }),
  getRtcToken: (payload: { chatToken: string; room: string; identity: string }) => invoke<{
    serverUrl: string;
    token: string;
  }>("rtc.token", payload),
};

export function invokeOpenIMSdk(method: string, ...args: unknown[]) {
  return invoke<any>("sdk.call", { method, args });
}

export function resetOpenIMHostInstance() {
  instanceIdPromise = null;
}
