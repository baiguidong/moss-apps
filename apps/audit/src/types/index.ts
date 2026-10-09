export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AuditFindingStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';

export type AuditSessionRecord = {
  id: string;
  title: string;
  workspace: string;
  projectId: string | null;
  assistantName: string | null;
  sessionKind: 'chat' | 'cron' | 'agent-mail';
  isSubAgent: boolean;
  sourceCreatedAt: number;
  sourceUpdatedAt: number;
  auditedAt: number;
  latestRunId: string;
  eventCount: number;
  toolCallCount: number;
  findingCount: number;
  completeness: 'complete' | 'partial';
  sourcePresent: boolean;
};

export type AuditToolCallRecord = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  toolUseId: string;
  parentToolUseId: string | null;
  toolName: string;
  input: unknown;
  result: string;
  status: 'success' | 'error' | 'unknown';
  isError: boolean;
  startedAt: number | null;
  completedAt: number | null;
  orderIndex: number;
};

export type AuditFindingRecord = {
  id: string;
  runId: string;
  sessionId: string;
  sessionTitle: string;
  toolCallId: string | null;
  toolName: string | null;
  toolUseId: string | null;
  toolInput: unknown;
  toolResult: string;
  toolStatus: 'success' | 'error' | 'unknown' | null;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  severity: AuditSeverity;
  title: string;
  detail: string;
  evidence: unknown;
  status: AuditFindingStatus;
  fingerprint: string;
  createdAt: number;
  reportedAt: number | null;
};

export type AuditAlert = {
  findingId: string;
  fingerprint: string;
  severity: 'high' | 'critical';
  title: string;
  detail: string;
  sessionId: string;
  sessionTitle: string;
  toolUseId: string | null;
  toolName: string | null;
  ruleName: string;
  createdAt: number;
};

export type AuditRuleRecord = {
  id: string;
  name: string;
  description: string;
  severity: AuditSeverity;
  enabled: boolean;
  config: { patterns?: string[]; minimumFailures?: number; allowedPaths?: string[] };
  version: number;
  updatedAt: number;
};

export type AuditRunRecord = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  scope: { kind?: string; sessionIds?: string[] };
  ruleSnapshot: AuditRuleRecord[];
  startedAt: number;
  completedAt: number | null;
  sessionCount: number;
  toolCallCount: number;
  findingCount: number;
  error: string | null;
};

export type AuditEventRecord = {
  id: string;
  sessionId: string;
  eventType: string;
  userMessageId: string | null;
  details: Record<string, unknown>;
  messageCount: number;
  toolCallCount: number;
  createdAt: number;
};

export type AuditEventDetail = AuditEventRecord & {
  history: unknown[];
  tools: Array<{
    id: string;
    eventId: string;
    sessionId: string;
    toolUseId: string;
    parentToolUseId: string | null;
    toolName: string;
    input: unknown;
    result: string;
    status: 'success' | 'error' | 'unknown';
    isError: boolean;
    orderIndex: number;
  }>;
};

export type AuditDashboardPayload = {
  summary: {
    sessionCount: number;
    toolCallCount: number;
    findingCount: number;
    openFindingCount: number;
    criticalFindingCount: number;
    incompleteSessionCount: number;
    latestCompletedAt: number;
    rulesStale: boolean;
    running: boolean;
    eventCount: number;
  };
  sessions: AuditSessionRecord[];
  tools: AuditToolCallRecord[];
  findings: AuditFindingRecord[];
  rules: AuditRuleRecord[];
  runs: AuditRunRecord[];
  events: AuditEventRecord[];
};
