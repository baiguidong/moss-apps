export {};

declare global {
  type OpenIMLocalFile = {
    name: string;
    path: string;
    size: number;
    mediaUrl: string;
  };

  interface Window {
    mossApp: import('@moss/app-sdk').AppUiApi & {
      app: import('@moss/app-sdk').AppUiApi['app'] & {
        getInfo(): Promise<{ appearance?: import('@moss/app-sdk').AppAppearance & { theme?: 'light' | 'dark' | 'system' } }>;
      };
    };
  }
}
