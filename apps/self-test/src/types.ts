export type SelfTestCase = {
  id: string; title: string; default: boolean; requiresModel: boolean;
  prerequisites: string[]; steps: string[]; expected: string[];
};
export type SelfTestStatus = {
  phase: 'idle' | 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'canceled' | 'interrupted';
  message: string; disabled?: boolean; id?: string; sessionId?: string | null; reportPath?: string;
  model?: string; permissionMode?: 'bypassPermissions';
  reportHtmlPath?: string; reportOpenError?: string;
  startedAt?: number;
  preparation?: { stage: string; label: string; current?: number; total?: number; item?: string; updatedAt: number };
  inheritedApps?: { id: string; version: string; enabled: boolean }[];
  cases?: SelfTestCase[];
  results?: Record<string, { status: 'pending' | 'passed' | 'failed' | 'blocked'; notes?: string }>;
};
export type SelfTestInstanceStatus = {
  phase: 'closed' | 'starting' | 'open'; prepared: boolean; home: string; directory: string; message: string;
  id?: string; pid?: number | null; startedAt?: number; preparedAt?: number; inheritedApps?: { id: string; version: string; enabled: boolean }[];
  progress?: SelfTestStatus['preparation'] | null;
};
