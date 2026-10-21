export type SelfTestCase = {
  id: string; title: string; default: boolean; requiresModel: boolean;
  group?: string; sources?: string[]; timeoutSeconds?: number;
  prerequisites: string[]; steps: string[]; expected: string[];
};
export type SelfTestStatus = {
  phase: 'idle' | 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'canceled' | 'interrupted';
  message: string; disabled?: boolean; id?: string; sessionId?: string | null; reportPath?: string;
  model?: string; permissionMode?: 'bypassPermissions';
  executionMode?: 'pipeline'; executionCaseId?: string | null; diagnosisCaseIds?: string[];
  hostBuildId?: string; selfTestPackageHash?: string; environmentRevision?: string; environmentPreparedAt?: number;
  reportHtmlPath?: string; reportOpenError?: string;
  resetData?: boolean; environmentReadyAt?: number; controllerReadyAt?: number;
  startedAt?: number; finishedAt?: number | null; activeCaseId?: string | null; activeCaseIds?: string[];
  controllerSessions?: { sessionId: string | null; caseIds: string[]; stage?: string; evidenceReview?: boolean; startedAt: number; finishedAt?: number; promptChars: number[]; error?: string }[];
  preparation?: { stage: string; label: string; current?: number; total?: number; item?: string; updatedAt: number };
  inheritedApps?: { id: string; version: string; enabled: boolean }[];
  cases?: SelfTestCase[];
  results?: Record<string, { status: 'pending' | 'passed' | 'failed' | 'blocked'; notes?: string; reasonCode?: string;
    startedAt?: number; finishedAt?: number; recordedAt?: number; executionMs?: number; executionFinishedAt?: number; reviewStartedAt?: number; reviewWaitMs?: number; stage?: string; controllerSessionId?: string;
    checks?: { index: number; passed: boolean; actual: string }[]; evidence?: string[] }>;
};
export type SelfTestInstanceStatus = {
  phase: 'closed' | 'starting' | 'open'; prepared: boolean; home: string; directory: string; message: string; disabled?: boolean; web?: boolean;
  id?: string; pid?: number | null; startedAt?: number; preparedAt?: number; inheritedApps?: { id: string; version: string; enabled: boolean }[];
  progress?: SelfTestStatus['preparation'] | null;
};
