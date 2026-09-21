export {};

declare global {
  type OpenIMDirectory = {
    departments: Array<{
      id: string;
      orgId: string;
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
  };

  type OpenIMLocalFile = {
    name: string;
    path: string;
    size: number;
    mediaUrl: string;
  };

  interface Window {
    mossApp: {
      app: {
        getInfo: () => Promise<{
          appearance?: {
            themeMode?: "light" | "dark" | "system";
            theme?: "light" | "dark" | "system";
            cssThemeId?: "default" | "grid-theme" | "dot-theme" | "gradient-theme";
          };
        }>;
      };
      events: { on: (name: string, callback: (payload: any) => void) => () => void };
      host: { request: <T = unknown>(instanceId: string, protocol: string, method: string, input?: Record<string, unknown>) => Promise<T> };
      instances: {
        list: () => Promise<Array<{ id: string; enabled?: boolean }>>;
        setEnabled: (instanceId: string, enabled: boolean) => Promise<unknown>;
      };
    };
    agentDesktop: {
      openIM: {
        getConfig: () => Promise<{
          available: boolean;
          error: string;
          platformID: number;
          dataDir: string;
          logFilePath: string;
          mediaCacheDir: string;
        }>;
        createSession: () => Promise<{
          available: true;
          userID: string;
          imToken: string;
          chatToken?: string;
          expiresIn: number;
          apiAddr: string;
          wsAddr: string;
          rtcEnabled: boolean;
          capabilities: { createGroup: boolean };
          user: { id: string; name: string; email: string | null; orgId: string };
        }>;
        listDirectory: () => Promise<OpenIMDirectory>;
        prepareDirectConversation: (payload: { userID: string }) => Promise<{ userID: string; name: string; email: string | null }>;
        prepareGroupConversation: (payload: { userIDs: string[] }) => Promise<{ groupID: string; memberUserIDs: string[] }>;
        pickFiles: (payload: { kind: "image" | "video" | "audio" | "file" }) => Promise<OpenIMLocalFile[]>;
        materializeFile: (payload: { fileName: string; data: ArrayBuffer }) => Promise<OpenIMLocalFile>;
        createVideoThumbnail: (payload: { path: string }) => Promise<{ path: string; mediaUrl: string }>;
        captureScreen: () => Promise<OpenIMLocalFile>;
        download: (payload: { url: string; fileName: string }) => Promise<{ canceled: boolean; filePath?: string }>;
        openExternal: (url: string) => Promise<unknown>;
        getRtcToken: (payload: { chatToken: string; room: string; identity: string }) => Promise<{ serverUrl: string; token: string }>;
      };
    };
    openIMRenderApi?: any;
  }
}
