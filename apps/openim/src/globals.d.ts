export {};

declare global {
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
      host: {
        request: <T = unknown>(
          instanceId: string,
          protocol: string,
          method: string,
          input?: Record<string, unknown>,
        ) => Promise<T>;
      };
      actions: {
        invoke: <T = unknown>(
          instanceId: string,
          name: string,
          input?: unknown,
          options?: { requestId?: string; timeoutMs?: number; target?: "desktop" | "server" },
        ) => Promise<T>;
        cancel: (
          instanceId: string,
          requestId: string,
          options?: { target?: "desktop" | "server" },
        ) => Promise<{ canceled: boolean }>;
      };
      instances: {
        list: () => Promise<Array<{ id: string; enabled?: boolean }>>;
        setEnabled: (instanceId: string, enabled: boolean) => Promise<unknown>;
      };
    };
  }
}
