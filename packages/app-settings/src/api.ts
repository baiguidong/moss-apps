import { createAppClient } from '@moss/app-sdk/ui';
import type { AppUiApi } from '@moss/app-sdk';
import type { McpCatalog } from '@moss/app-sdk/mcp';
import type { AppToolScopeSettings, AppMcpServiceSettings, AppMcpSettingsMethod, McpHostInputMap } from './types';

let client: ReturnType<typeof createAppClient> | undefined;
const getClient = () => {
  const bridge = (window as unknown as { mossApp?: AppUiApi }).mossApp;
  if (!bridge) throw new Error('请在 Moss 中打开应用设置。');
  return client ??= createAppClient(bridge);
};
export const cleanIpcErrorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const project = (catalog: McpCatalog): AppMcpServiceSettings[] => catalog.servers.map(server => ({
  ...server,
  status: !server.enabled ? 'disabled' : server.credentialsMissing ? 'credentials-missing' : server.check?.state || 'unchecked',
  tools: server.check?.tools || [], error: server.check?.error, truncated: server.check?.truncated,
}));

export const api = {
  getToolScope: () => getClient().host.request('moss.host/v1', 'tools.scope.get', {}) as Promise<AppToolScopeSettings>,
  setToolScope: ({ scope }: { scope: 'session' | 'global' | null }) => getClient().host.request('moss.host/v1', 'tools.scope.set', { scope }) as Promise<AppToolScopeSettings>,
  listMcpServers: async () => project(await getClient().host.request('moss.mcp/v1', 'servers.list', {}) as McpCatalog),
  updateMcpServer: async (method: AppMcpSettingsMethod, input: McpHostInputMap[AppMcpSettingsMethod]) =>
    project(await getClient().host.request('moss.mcp/v1', method, input, { timeoutMs: method === 'auth.start' ? 300_000 : 65_000 }) as McpCatalog),
  onRuntime: (refresh: () => void) => {
    try { return getClient().events.on('runtime', refresh); }
    catch { return () => {}; }
  },
  installation: () => getClient().app.getInstallationState(),
};
