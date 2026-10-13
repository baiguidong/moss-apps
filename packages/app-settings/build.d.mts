export const SETTINGS_ROUTE: '#/moss-settings';
export function buildAppSettings(appRoot: string, options?: { outputDir?: string; html?: string }): Promise<string>;
export function appSettingsPlugin(appRoot: string | URL): {
  name: string;
  apply: 'serve';
  configResolved(config: any): void;
  configureServer(server: any): void;
  transformIndexHtml(html: string): Promise<string>;
};
