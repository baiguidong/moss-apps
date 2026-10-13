import type { McpServer, McpHostInputMap } from '@moss/app-sdk/mcp';

export type StoredApp = {
  id: string; name: string; title: string; enabled: boolean; grants: string[];
  toolSelection?: 'app' | 'services'; mcp: boolean;
  primaryRoute: string;
  tools: Array<{ id: string; title?: string; description?: string }>;
};
export type AppToolScopeSettings = { scope: 'session' | 'global'; defaultScope: 'session' | 'global'; overridden: boolean };
export type AppMcpSettingsMethod = 'servers.save' | 'servers.set-enabled' | 'servers.inspect' | 'auth.start' | 'auth.clear';
export type AppMcpServiceSettings = McpServer & {
  status: 'app-disabled' | 'instance-disabled' | 'unauthorized' | 'disabled' | 'credentials-missing' | 'unchecked' | 'authorized' | 'connected' | 'needs-auth' | 'failed';
  tools: NonNullable<McpServer['check']>['tools']; error?: string; truncated?: boolean;
};
export type { McpHostInputMap };
