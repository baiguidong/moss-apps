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
        getInfo(): Promise<{ appearance?: { themeMode?: 'light' | 'dark' | 'system'; theme?: 'light' | 'dark' | 'system'; cssThemeId?: 'default' | 'grid-theme' | 'dot-theme' | 'gradient-theme' } }>;
      };
    };
  }
}
