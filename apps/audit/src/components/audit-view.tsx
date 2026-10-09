"use client";
import { auditApi } from "../lib/api";

import * as React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  History,
  LocateFixed,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  AuditDashboardPayload,
  AuditEventDetail,
  AuditEventRecord,
  AuditFindingRecord,
  AuditFindingStatus,
  AuditRunRecord,
  AuditRuleRecord,
  AuditSeverity,
  AuditSessionRecord,
  AuditToolCallRecord,
} from "../types";

type AuditTab = "sessions" | "findings" | "tools" | "events" | "rules" | "runs";
type SortDirection = "asc" | "desc";
type AuditSortSpec = { key: string; direction: SortDirection };

const DEFAULT_SORTS: Record<AuditTab, AuditSortSpec> = {
  sessions: { key: "updatedAt", direction: "desc" },
  findings: { key: "severity", direction: "desc" },
  tools: { key: "startedAt", direction: "desc" },
  events: { key: "createdAt", direction: "desc" },
  rules: { key: "name", direction: "asc" },
  runs: { key: "startedAt", direction: "desc" },
};

const TABS: Array<{ id: AuditTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "sessions", label: "会话", icon: CircleDot },
  { id: "findings", label: "发现", icon: AlertTriangle },
  { id: "tools", label: "工具调用", icon: Wrench },
  { id: "events", label: "操作事件", icon: RotateCcw },
  { id: "rules", label: "规则", icon: SlidersHorizontal },
  { id: "runs", label: "审计记录", icon: History },
];

const SEVERITY_LABELS: Record<AuditSeverity, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

const FINDING_STATUS_LABELS: Record<AuditFindingStatus, string> = {
  open: "待处理",
  acknowledged: "已确认",
  resolved: "已解决",
  false_positive: "误报",
};

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  defaultDirection = "asc",
}: {
  label: string;
  sortKey: string;
  sort: AuditSortSpec;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
  defaultDirection?: SortDirection;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      type="button"
      className={cn("inline-flex min-w-0 items-center gap-1 text-left hover:text-foreground", active && "text-foreground")}
      onClick={() => onSort(sortKey, defaultDirection)}
    >
      <span className="truncate">{label}</span>
      <Icon className="h-3 w-3 shrink-0" />
    </button>
  );
}

export function sortRows<T>(
  rows: T[],
  sort: AuditSortSpec,
  getValue: (row: T, key: string) => string | number | boolean | null | undefined,
) {
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = getValue(left, sort.key);
    const rightValue = getValue(right, sort.key);
    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    const compared = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : collator.compare(String(leftValue), String(rightValue));
    return compared * direction;
  });
}

function formatTime(value: number | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatDuration(startedAt: number, completedAt: number | null) {
  if (!completedAt) return "进行中";
  const duration = Math.max(0, completedAt - startedAt);
  return duration < 1_000 ? `${duration} ms` : `${(duration / 1_000).toFixed(1)} s`;
}

function searchable(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function prettyJson(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-10 items-center justify-center rounded px-1.5 text-[11px] font-medium",
        severity === "critical" && "bg-red-500/15 text-red-600 dark:text-red-400",
        severity === "high" && "bg-orange-500/15 text-orange-700 dark:text-orange-400",
        severity === "medium" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        severity === "low" && "bg-sky-500/15 text-sky-700 dark:text-sky-400",
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

function EmptyState({ tab, onRun }: { tab: AuditTab; onRun: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center">
      <ShieldCheck className="h-8 w-8 text-muted-foreground/55" />
      <div className="text-sm font-medium text-foreground">
        {tab === "findings" ? "没有匹配的审计发现" : tab === "tools" ? "没有匹配的工具调用" : "还没有本地审计数据"}
      </div>
      {tab === "sessions" && (
        <Button size="sm" variant="outline" className="h-8" onClick={onRun}>
          开始审计
        </Button>
      )}
    </div>
  );
}

function SessionTable({
  sessions,
  onOpenSession,
  onAuditSession,
  auditingSessionIds,
  auditDisabled,
  sort,
  onSort,
}: {
  sessions: AuditSessionRecord[];
  onOpenSession?: (sessionId: string) => void;
  onAuditSession: (session: AuditSessionRecord) => void;
  auditingSessionIds: Set<string>;
  auditDisabled: boolean;
  sort: AuditSortSpec;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
}) {
  return (
    <div className="min-w-[820px]">
      <div className="grid grid-cols-[minmax(260px,1fr)_100px_100px_90px_120px_92px] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-medium text-muted-foreground">
        <SortHeader label="会话" sortKey="title" sort={sort} onSort={onSort} />
        <SortHeader label="类型" sortKey="type" sort={sort} onSort={onSort} />
        <SortHeader label="工具调用" sortKey="toolCallCount" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="发现" sortKey="findingCount" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="更新时间" sortKey="updatedAt" sort={sort} onSort={onSort} defaultDirection="desc" />
        <span />
      </div>
      {sessions.map((session) => (
        <div key={session.id} className="grid grid-cols-[minmax(260px,1fr)_100px_100px_90px_120px_92px] items-center border-b border-border/55 px-4 py-2.5 text-xs hover:bg-muted/20">
          <button className="min-w-0 text-left" onClick={() => onOpenSession?.(session.id)}>
            <span className="block truncate font-medium text-foreground">{session.title}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{session.workspace || session.id}</span>
          </button>
          <span className="text-muted-foreground">{session.isSubAgent ? "子代理" : session.sessionKind === "cron" ? "定时任务" : "会话"}</span>
          <span className="text-muted-foreground">
            {session.toolCallCount}
            {session.completeness === "partial" && <span className="ml-1 text-amber-600">不完整</span>}
          </span>
          <span className={cn("font-medium", session.findingCount > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{session.findingCount}</span>
          <span className="text-muted-foreground">{formatTime(session.sourceUpdatedAt)}</span>
          <Button variant="ghost" size="sm" className="h-7 justify-start px-2 text-[11px]" onClick={() => onAuditSession(session)} disabled={auditDisabled}>
            {auditingSessionIds.has(session.id) && <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {auditingSessionIds.has(session.id) ? "审计中" : "重审"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function FindingsTable({
  findings,
  selectedIds,
  onToggleSelected,
  onToggleAll,
  onOpenSession,
  onLocateTool,
  onStatusChange,
  sort,
  onSort,
}: {
  findings: AuditFindingRecord[];
  selectedIds: Set<string>;
  onToggleSelected: (id: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onOpenSession?: (sessionId: string) => void;
  onLocateTool?: (sessionId: string, toolUseId: string) => void;
  onStatusChange: (finding: AuditFindingRecord, status: AuditFindingStatus) => void;
  sort: AuditSortSpec;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
}) {
  const allSelected = findings.length > 0 && findings.every((finding) => selectedIds.has(finding.id));
  return (
    <div className="min-w-[1020px]">
      <div className="grid grid-cols-[36px_76px_minmax(220px,1fr)_minmax(180px,0.8fr)_130px_120px] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-medium text-muted-foreground">
        <input type="checkbox" checked={allSelected} onChange={(event) => onToggleAll(event.target.checked)} className="h-4 w-4 accent-primary" aria-label="全选当前发现" />
        <SortHeader label="级别" sortKey="severity" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="发现" sortKey="title" sort={sort} onSort={onSort} />
        <SortHeader label="会话 / 工具" sortKey="session" sort={sort} onSort={onSort} />
        <SortHeader label="规则" sortKey="rule" sort={sort} onSort={onSort} />
        <SortHeader label="状态" sortKey="status" sort={sort} onSort={onSort} />
      </div>
      {findings.map((finding) => {
        const hasTool = Boolean(finding.toolCallId && finding.toolUseId);
        return (
          <div key={finding.id} className={cn("grid grid-cols-[36px_76px_minmax(220px,1fr)_minmax(180px,0.8fr)_130px_120px] items-start border-b border-border/55 px-4 py-2.5 text-xs hover:bg-muted/20", selectedIds.has(finding.id) && "bg-primary/5")}>
            <input type="checkbox" checked={selectedIds.has(finding.id)} onChange={(event) => onToggleSelected(finding.id, event.target.checked)} className="h-4 w-4 accent-primary" aria-label={`选择发现：${finding.title}`} />
            <SeverityBadge severity={finding.severity} />
            <details className="group min-w-0 pr-4">
              <summary className="cursor-pointer list-none font-medium text-foreground">
                <span className="inline-flex max-w-full items-center gap-1">
                  <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                  <span className="truncate">{finding.title}</span>
                </span>
              </summary>
              <div className="mt-2 overflow-hidden rounded border border-border/60 bg-muted/20">
                <div className="flex items-center gap-2 border-b border-border/55 px-2.5 py-2">
                  <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-foreground">{finding.toolName || "会话事件"}</span>
                  {hasTool && onLocateTool && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={() => onLocateTool(finding.sessionId, finding.toolUseId!)}
                    >
                      <LocateFixed className="mr-1 h-3.5 w-3.5" />
                      在会话中定位
                    </Button>
                  )}
                </div>
                <div className="grid gap-px bg-border/50 sm:grid-cols-2">
                  <div className="min-w-0 bg-background p-2.5">
                    <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">输入</div>
                    <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-foreground/85">{hasTool ? prettyJson(finding.toolInput) : "无工具输入"}</pre>
                  </div>
                  <div className="min-w-0 bg-background p-2.5">
                    <div className="mb-1.5 text-[10px] font-medium text-muted-foreground">输出</div>
                    <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-foreground/85">{finding.toolResult || "无工具输出"}</pre>
                  </div>
                </div>
                <div className="border-t border-border/55 px-2.5 py-2">
                  <div className="mb-1 text-[10px] font-medium text-muted-foreground">命中内容</div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-muted-foreground">{finding.detail}</pre>
                </div>
              </div>
            </details>
            <button
              className="min-w-0 pr-3 text-left"
              title={hasTool && onLocateTool ? "在会话中定位此工具调用" : "打开会话"}
              onClick={() => {
                if (hasTool && onLocateTool) {
                  onLocateTool(finding.sessionId, finding.toolUseId!);
                } else {
                  onOpenSession?.(finding.sessionId);
                }
              }}
            >
              <span className="block truncate text-foreground hover:underline">{finding.sessionTitle}</span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
                {hasTool && onLocateTool ? <LocateFixed className="h-3 w-3 shrink-0" /> : null}
                <span className="truncate">{finding.toolName || "会话事件"}</span>
              </span>
            </button>
            <span className="truncate pr-2 text-muted-foreground" title={finding.ruleName}>{finding.ruleName}</span>
            <select
              aria-label="发现状态"
              className="h-7 rounded border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-ring"
              value={finding.status}
              onChange={(event) => onStatusChange(finding, event.target.value as AuditFindingStatus)}
            >
              {Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function ToolsTable({
  tools,
  onLocateTool,
  sort,
  onSort,
}: {
  tools: AuditToolCallRecord[];
  onLocateTool?: (sessionId: string, toolUseId: string) => void;
  sort: AuditSortSpec;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
}) {
  return (
    <div className="min-w-[900px]">
      <div className="grid grid-cols-[88px_minmax(170px,0.7fr)_minmax(220px,1fr)_110px_120px] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-medium text-muted-foreground">
        <SortHeader label="状态" sortKey="status" sort={sort} onSort={onSort} />
        <SortHeader label="工具" sortKey="toolName" sort={sort} onSort={onSort} />
        <SortHeader label="会话 / 详情" sortKey="session" sort={sort} onSort={onSort} />
        <SortHeader label="耗时" sortKey="duration" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="时间" sortKey="startedAt" sort={sort} onSort={onSort} defaultDirection="desc" />
      </div>
      {tools.map((tool) => (
        <div key={tool.id} className="grid grid-cols-[88px_minmax(170px,0.7fr)_minmax(220px,1fr)_110px_120px] items-start border-b border-border/55 px-4 py-2.5 text-xs hover:bg-muted/20">
          <span className={cn("inline-flex items-center gap-1.5", tool.status === "error" ? "text-red-600 dark:text-red-400" : tool.status === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
            {tool.status === "success" ? <CheckCircle2 className="h-3.5 w-3.5" /> : tool.status === "error" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
            {tool.status === "success" ? "成功" : tool.status === "error" ? "失败" : "未知"}
          </span>
          <span className="truncate pr-3 font-mono text-[11px] text-foreground" title={tool.toolName}>{tool.toolName}</span>
          <details className="group min-w-0 pr-4">
            <summary className="cursor-pointer list-none truncate text-foreground">
              <ChevronRight className="mr-1 inline h-3 w-3 text-muted-foreground transition-transform group-open:rotate-90" />
              {tool.sessionTitle}
            </summary>
            <div className="mt-2 grid gap-2">
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-muted/30 p-2 font-mono text-[11px] leading-5 text-muted-foreground">{prettyJson(tool.input)}</pre>
              {tool.result && <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-muted/30 p-2 font-mono text-[11px] leading-5 text-muted-foreground">{tool.result}</pre>}
              {onLocateTool && (
                <Button variant="ghost" size="sm" className="h-7 w-fit px-2 text-[11px]" onClick={() => onLocateTool(tool.sessionId, tool.toolUseId)}>
                  <LocateFixed className="mr-1 h-3.5 w-3.5" />
                  在会话中定位
                </Button>
              )}
            </div>
          </details>
          <span className="text-muted-foreground">{tool.completedAt && tool.startedAt ? formatDuration(tool.startedAt, tool.completedAt) : "-"}</span>
          <span className="text-muted-foreground">{formatTime(tool.startedAt)}</span>
        </div>
      ))}
    </div>
  );
}

function RuleEditor({ rule, onClose, onSave }: { rule: AuditRuleRecord; onClose: () => void; onSave: (config: AuditRuleRecord["config"]) => Promise<void> }) {
  const usesPatterns = rule.id === "destructive-command" || rule.id === "sensitive-file-access";
  const usesAllowedPaths = rule.id === "outside-workspace-write";
  const [value, setValue] = React.useState(
    usesPatterns
      ? (rule.config.patterns || []).join("\n")
      : usesAllowedPaths
        ? (rule.config.allowedPaths || []).join("\n")
        : String(rule.config.minimumFailures || 1),
  );
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const config = usesPatterns
        ? { patterns: value.split("\n").map((line) => line.trim()).filter(Boolean) }
        : usesAllowedPaths
          ? { allowedPaths: value.split("\n").map((line) => line.trim()).filter(Boolean) }
        : rule.id === "failed-tool-call"
          ? { minimumFailures: Number(value) }
          : {};
      await onSave(config);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <div className="w-full max-w-lg rounded-lg border border-border bg-background shadow-2xl">
        <div className="flex items-center border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">{rule.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">规则参数</div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="关闭"><X className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-3 p-4">
          {usesPatterns || usesAllowedPaths ? (
            <Textarea value={value} onChange={(event) => setValue(event.target.value)} className="min-h-52 resize-y font-mono text-xs" aria-label={usesAllowedPaths ? "允许路径，每行一条" : "正则表达式，每行一条"} />
          ) : rule.id === "failed-tool-call" ? (
            <Input type="number" min={1} max={100} value={value} onChange={(event) => setValue(event.target.value)} aria-label="最少失败次数" />
          ) : (
            <div className="py-6 text-center text-xs text-muted-foreground">此规则没有可配置参数</div>
          )}
          {error && <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || (!usesPatterns && !usesAllowedPaths && rule.id !== "failed-tool-call")}>{saving ? "保存中" : "保存"}</Button>
        </div>
      </div>
    </div>
  );
}

function RulesTable({
  rules,
  onUpdate,
  onEdit,
  sort,
  onSort,
}: {
  rules: AuditRuleRecord[];
  onUpdate: (rule: AuditRuleRecord, patch: Partial<Pick<AuditRuleRecord, "enabled" | "severity">>) => void;
  onEdit: (rule: AuditRuleRecord) => void;
  sort: AuditSortSpec;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
}) {
  return (
    <div className="min-w-[800px]">
      <div className="grid grid-cols-[80px_minmax(300px,1fr)_130px_100px_90px] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-medium text-muted-foreground">
        <SortHeader label="启用" sortKey="enabled" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="规则" sortKey="name" sort={sort} onSort={onSort} />
        <SortHeader label="严重级别" sortKey="severity" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="版本" sortKey="version" sort={sort} onSort={onSort} defaultDirection="desc" />
        <span />
      </div>
      {rules.map((rule) => (
        <div key={rule.id} className="grid grid-cols-[80px_minmax(300px,1fr)_130px_100px_90px] items-center border-b border-border/55 px-4 py-3 text-xs hover:bg-muted/20">
          <input type="checkbox" checked={rule.enabled} onChange={(event) => onUpdate(rule, { enabled: event.target.checked })} className="h-4 w-4 accent-primary" aria-label={`${rule.name}启用状态`} />
          <div className="min-w-0 pr-5">
            <div className="font-medium text-foreground">{rule.name}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={rule.description}>{rule.description}</div>
          </div>
          <select className="h-7 w-24 rounded border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-ring" value={rule.severity} onChange={(event) => onUpdate(rule, { severity: event.target.value as AuditSeverity })} aria-label={`${rule.name}严重级别`}>
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="text-muted-foreground">v{rule.version}</span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onEdit(rule)}>参数</Button>
        </div>
      ))}
    </div>
  );
}

function RunsTable({
  runs,
  sort,
  onSort,
}: {
  runs: AuditRunRecord[];
  sort: AuditSortSpec;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
}) {
  return (
    <div className="min-w-[760px]">
      <div className="grid grid-cols-[150px_110px_100px_100px_100px_1fr] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-medium text-muted-foreground">
        <SortHeader label="开始时间" sortKey="startedAt" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="状态" sortKey="status" sort={sort} onSort={onSort} />
        <SortHeader label="会话" sortKey="sessionCount" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="工具" sortKey="toolCallCount" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="发现" sortKey="findingCount" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="耗时 / 错误" sortKey="duration" sort={sort} onSort={onSort} defaultDirection="desc" />
      </div>
      {runs.map((run) => (
        <div key={run.id} className="grid grid-cols-[150px_110px_100px_100px_100px_1fr] border-b border-border/55 px-4 py-2.5 text-xs hover:bg-muted/20">
          <span className="text-muted-foreground">{formatTime(run.startedAt)}</span>
          <span className={cn(run.status === "failed" ? "text-red-600" : run.status === "completed" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}>{run.status === "completed" ? "已完成" : run.status === "failed" ? "失败" : "进行中"}</span>
          <span>{run.sessionCount}</span>
          <span>{run.toolCallCount}</span>
          <span>{run.findingCount}</span>
          <span className="truncate text-muted-foreground" title={run.error || ""}>{run.error || formatDuration(run.startedAt, run.completedAt)}</span>
        </div>
      ))}
    </div>
  );
}

function AuditEventsTable({
  events,
  onOpen,
  sort,
  onSort,
}: {
  events: AuditEventRecord[];
  onOpen: (event: AuditEventRecord) => void;
  sort: AuditSortSpec;
  onSort: (key: string, defaultDirection?: SortDirection) => void;
}) {
  return (
    <div className="min-w-[820px]">
      <div className="grid grid-cols-[150px_minmax(220px,1fr)_110px_100px_minmax(180px,0.8fr)_90px] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-medium text-muted-foreground">
        <SortHeader label="时间" sortKey="createdAt" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="事件" sortKey="eventType" sort={sort} onSort={onSort} />
        <SortHeader label="消息" sortKey="messageCount" sort={sort} onSort={onSort} defaultDirection="desc" />
        <SortHeader label="工具" sortKey="toolCallCount" sort={sort} onSort={onSort} defaultDirection="desc" />
        <span>轮次 ID</span>
        <span />
      </div>
      {events.map((event) => (
        <div key={event.id} className="grid grid-cols-[150px_minmax(220px,1fr)_110px_100px_minmax(180px,0.8fr)_90px] items-center border-b border-border/55 px-4 py-2.5 text-xs hover:bg-muted/20">
          <span className="text-muted-foreground">{formatTime(event.createdAt)}</span>
          <span className="inline-flex min-w-0 items-center gap-2 font-medium text-foreground">
            <RotateCcw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{event.eventType === "turn_reverted" ? "整轮撤销" : event.eventType}</span>
          </span>
          <span className="tabular-nums text-muted-foreground">{event.messageCount}</span>
          <span className="tabular-nums text-muted-foreground">{event.toolCallCount}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground" title={event.userMessageId || ""}>{event.userMessageId || "-"}</span>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onOpen(event)}>查看</Button>
        </div>
      ))}
    </div>
  );
}

function AuditEventViewer({
  event,
  detail,
  loading,
  onClose,
}: {
  event: AuditEventRecord;
  detail: AuditEventDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={(mouseEvent) => { if (mouseEvent.currentTarget === mouseEvent.target) onClose(); }}>
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        <div className="flex items-center border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">{event.eventType === "turn_reverted" ? "整轮撤销审计记录" : event.eventType}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{formatTime(event.createdAt)} · {event.sessionId}</div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="关闭"><X className="h-4 w-4" /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取完整记录</div>
          ) : detail ? (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">撤销结果</div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-5 text-foreground/85">{prettyJson(detail.details)}</pre>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">已移除的完整对话 · {detail.history.length} 条</div>
                <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-all rounded border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-5 text-foreground/85">{prettyJson(detail.history)}</pre>
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-xs text-destructive">无法读取这条审计记录</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuditView({
  onOpenSession,
  onLocateTool,
  onNotice,
  onError,
}: {
  onOpenSession?: (sessionId: string) => void;
  onLocateTool?: (sessionId: string, toolUseId: string) => void;
  onNotice?: (message: string) => void;
  onError?: (error: { title: string; message: string; details?: string }) => void;
}) {
  const [dashboard, setDashboard] = React.useState<AuditDashboardPayload | null>(null);
  const [activeTab, setActiveTab] = React.useState<AuditTab>("sessions");
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [auditingSessionIds, setAuditingSessionIds] = React.useState<Set<string>>(() => new Set());
  const [progress, setProgress] = React.useState<{ completed: number; total: number } | null>(null);
  const [error, setError] = React.useState("");
  const [editingRule, setEditingRule] = React.useState<AuditRuleRecord | null>(null);
  const [selectedEvent, setSelectedEvent] = React.useState<AuditEventRecord | null>(null);
  const [eventDetail, setEventDetail] = React.useState<AuditEventDetail | null>(null);
  const [eventLoading, setEventLoading] = React.useState(false);
  const [selectedFindingIds, setSelectedFindingIds] = React.useState<Set<string>>(() => new Set());
  const [batchFindingStatus, setBatchFindingStatus] = React.useState<AuditFindingStatus>("acknowledged");
  const [batchUpdating, setBatchUpdating] = React.useState(false);
  const [sorts, setSorts] = React.useState<Record<AuditTab, AuditSortSpec>>(DEFAULT_SORTS);

  const reportError = React.useCallback((title: string, caught: unknown) => {
    const message = caught instanceof Error ? caught.message : String(caught);
    setError(message);
    onError?.({ title, message });
  }, [onError]);

  const refresh = React.useCallback(async () => {
    try {
      const next = await auditApi.getDashboard();
      setDashboard(next);
      setRunning(next.runs.some((run) => run.status === "running" && run.scope.kind !== "sessions"));
      setAuditingSessionIds(new Set(
        next.runs
          .filter((run) => run.status === "running" && run.scope.kind === "sessions")
          .flatMap((run) => run.scope.sessionIds || []),
      ));
      setError("");
    } catch (caught) {
      reportError("读取审计数据失败", caught);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  React.useEffect(() => {
    void refresh();
    return auditApi.onChanged((event) => {
      const isSessionRun = event.scope?.kind === "sessions";
      const scopedSessionIds = event.scope?.sessionIds || [];
      if (event.reason === "run-started") {
        if (isSessionRun) {
          setAuditingSessionIds((current) => new Set([...current, ...scopedSessionIds]));
        } else {
          setRunning(true);
          setProgress({ completed: 0, total: event.total || 0 });
        }
      } else if (event.reason === "run-progress") {
        if (!isSessionRun) setProgress({ completed: event.completed || 0, total: event.total || 0 });
      } else if (event.reason === "run-completed" || event.reason === "run-failed") {
        if (isSessionRun) {
          setAuditingSessionIds((current) => {
            const next = new Set(current);
            scopedSessionIds.forEach((id) => next.delete(id));
            return next;
          });
        } else {
          setRunning(false);
          setProgress(null);
        }
        void refresh();
      } else if (event.reason === "rule-updated" || event.reason === "finding-updated" || event.reason === "findings-updated" || event.reason === "sources-reconciled" || event.reason === "event-recorded" || event.reason === "event-updated") {
        void refresh();
      }
    });
  }, [refresh]);

  const runFullAudit = React.useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      await auditApi.run();
      await refresh();
    } catch (caught) {
      reportError("执行本地审计失败", caught);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [refresh, reportError]);

  const runSessionAudit = React.useCallback(async (session: AuditSessionRecord) => {
    setAuditingSessionIds((current) => new Set(current).add(session.id));
    setError("");
    try {
      const result = await auditApi.run({ sessionIds: [session.id] });
      await refresh();
      onNotice?.(`“${session.title}”审计完成：${result.toolCallCount} 个工具调用，${result.findingCount} 个发现`);
    } catch (caught) {
      reportError("重新审计会话失败", caught);
    } finally {
      setAuditingSessionIds((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
    }
  }, [onNotice, refresh, reportError]);

  const updateRule = React.useCallback(async (
    rule: AuditRuleRecord,
    patch: Partial<Pick<AuditRuleRecord, "enabled" | "severity">> & { config?: AuditRuleRecord["config"] },
    rethrow = false,
  ) => {
    setError("");
    try {
      await auditApi.updateRule({ id: rule.id, ...patch });
      await refresh();
    } catch (caught) {
      reportError("更新审计规则失败", caught);
      if (rethrow) throw caught;
    }
  }, [refresh, reportError]);

  const updateFinding = React.useCallback(async (finding: AuditFindingRecord, status: AuditFindingStatus) => {
    setDashboard((current) => current ? { ...current, findings: current.findings.map((entry) => entry.id === finding.id ? { ...entry, status } : entry) } : current);
    try {
      await auditApi.updateFinding({ id: finding.id, status });
    } catch (caught) {
      reportError("更新审计发现失败", caught);
      await refresh();
    }
  }, [refresh, reportError]);

  const updateSelectedFindings = React.useCallback(async () => {
    const ids = [...selectedFindingIds];
    if (ids.length === 0) return;
    setBatchUpdating(true);
    setDashboard((current) => current ? {
      ...current,
      findings: current.findings.map((entry) => selectedFindingIds.has(entry.id) ? { ...entry, status: batchFindingStatus } : entry),
    } : current);
    try {
      const result = await auditApi.updateFindings({ ids, status: batchFindingStatus });
      setSelectedFindingIds(new Set());
      onNotice?.(`已批量更新 ${result.updatedCount} 个审计发现`);
      await refresh();
    } catch (caught) {
      reportError("批量更新审计发现失败", caught);
      await refresh();
    } finally {
      setBatchUpdating(false);
    }
  }, [batchFindingStatus, onNotice, refresh, reportError, selectedFindingIds]);

  const changeSort = React.useCallback((tab: AuditTab, key: string, defaultDirection: SortDirection = "asc") => {
    setSorts((current) => ({
      ...current,
      [tab]: current[tab].key === key
        ? { key, direction: current[tab].direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultDirection },
    }));
  }, []);

  const openEvent = React.useCallback(async (event: AuditEventRecord) => {
    setSelectedEvent(event);
    setEventDetail(null);
    setEventLoading(true);
    try {
      setEventDetail(await auditApi.getEvent({ id: event.id }));
    } catch (caught) {
      reportError("读取撤销审计记录失败", caught);
    } finally {
      setEventLoading(false);
    }
  }, [reportError]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = React.useCallback((...values: unknown[]) => !normalizedQuery || values.some((value) => searchable(value).toLocaleLowerCase().includes(normalizedQuery)), [normalizedQuery]);
  const sessions = sortRows(
    (dashboard?.sessions || []).filter((session) => session.sourcePresent && matches(session.title, session.workspace, session.assistantName)),
    sorts.sessions,
    (session, key) => ({ title: session.title, type: session.isSubAgent ? "子代理" : session.sessionKind, toolCallCount: session.toolCallCount, findingCount: session.findingCount, updatedAt: session.sourceUpdatedAt }[key]),
  );
  const findings = sortRows(
    (dashboard?.findings || []).filter((finding) => matches(finding.title, finding.detail, finding.sessionTitle, finding.toolName, finding.toolInput, finding.toolResult, finding.ruleName, finding.status)),
    sorts.findings,
    (finding, key) => ({ severity: SEVERITY_ORDER[finding.severity], title: finding.title, session: `${finding.sessionTitle} ${finding.toolName || ""}`, rule: finding.ruleName, status: finding.status }[key]),
  );
  const tools = sortRows(
    (dashboard?.tools || []).filter((tool) => matches(tool.toolName, tool.sessionTitle, tool.input, tool.result, tool.status)),
    sorts.tools,
    (tool, key) => ({ status: tool.status, toolName: tool.toolName, session: tool.sessionTitle, duration: tool.completedAt && tool.startedAt ? tool.completedAt - tool.startedAt : null, startedAt: tool.startedAt }[key]),
  );
  const auditEvents = sortRows(
    (dashboard?.events || []).filter((event) => matches(event.eventType, event.sessionId, event.userMessageId, event.details)),
    sorts.events,
    (event, key) => ({ createdAt: event.createdAt, eventType: event.eventType, messageCount: event.messageCount, toolCallCount: event.toolCallCount }[key]),
  );
  const rules = sortRows(
    (dashboard?.rules || []).filter((rule) => matches(rule.name, rule.description, rule.id)),
    sorts.rules,
    (rule, key) => ({ enabled: rule.enabled, name: rule.name, severity: SEVERITY_ORDER[rule.severity], version: rule.version }[key]),
  );
  const runs = sortRows(
    dashboard?.runs || [],
    sorts.runs,
    (run, key) => ({ startedAt: run.startedAt, status: run.status, sessionCount: run.sessionCount, toolCallCount: run.toolCallCount, findingCount: run.findingCount, duration: run.completedAt ? run.completedAt - run.startedAt : null }[key]),
  );
  const summary = dashboard?.summary;
  const auditBusy = running || auditingSessionIds.size > 0;

  React.useEffect(() => {
    const currentFindingIds = new Set((dashboard?.findings || []).map((finding) => finding.id));
    setSelectedFindingIds((current) => {
      const next = new Set([...current].filter((id) => currentFindingIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [dashboard?.findings]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border/70 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1280px] items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-600 text-white"><ShieldCheck className="h-4.5 w-4.5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground">审计中心</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {running ? (progress?.total ? `正在审计 ${progress.completed}/${progress.total}` : "正在审计") : summary?.latestCompletedAt ? `最近完成于 ${formatTime(summary.latestCompletedAt)}` : "尚未执行"}
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={() => void refresh()} disabled={loading || auditBusy} title="刷新"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></Button>
          <Button size="sm" className="h-8" onClick={() => void runFullAudit()} disabled={auditBusy}>
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />{running ? "审计中" : "重新审计"}
          </Button>
        </div>
      </div>

      <div className="shrink-0 border-b border-border/70 bg-muted/10 px-4 sm:px-6">
        <div className="mx-auto grid max-w-[1280px] grid-cols-3 divide-x divide-border/70 sm:grid-cols-6">
          {[
            ["本地会话", summary?.sessionCount || 0],
            ["工具调用", summary?.toolCallCount || 0],
            ["审计发现", summary?.findingCount || 0],
            ["待处理", summary?.openFindingCount || 0],
            ["严重", summary?.criticalFindingCount || 0],
            ["数据不完整", summary?.incompleteSessionCount || 0],
          ].map(([label, value]) => (
            <div key={String(label)} className="px-3 py-2.5 first:pl-0 sm:px-4">
              <div className="text-[11px] text-muted-foreground">{label}</div>
              <div className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-b border-border/70 px-4 sm:px-6">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return <button key={tab.id} className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-xs transition-colors", activeTab === tab.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => setActiveTab(tab.id)}><Icon className="h-3.5 w-3.5" />{tab.label}</button>;
            })}
          </div>
          <div className="relative w-52 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 pl-8 text-xs" placeholder="搜索审计数据" />
          </div>
        </div>
      </div>

      {activeTab === "findings" && selectedFindingIds.size > 0 && (
        <div className="shrink-0 border-b border-border/70 bg-primary/5 px-4 py-2 sm:px-6">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2">
            <CheckCheck className="h-4 w-4 text-primary" />
            <span className="mr-auto text-xs font-medium text-foreground">已选择 {selectedFindingIds.size} 个发现</span>
            <select
              aria-label="批量设置发现状态"
              className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
              value={batchFindingStatus}
              onChange={(event) => setBatchFindingStatus(event.target.value as AuditFindingStatus)}
              disabled={batchUpdating}
            >
              {Object.entries(FINDING_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Button size="sm" className="h-8" onClick={() => void updateSelectedFindings()} disabled={batchUpdating}>
              {batchUpdating && <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              应用
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedFindingIds(new Set())} disabled={batchUpdating} title="清除选择">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {summary?.rulesStale && (
        <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/8 px-4 py-2 text-xs text-amber-800 dark:text-amber-300 sm:px-6">
          <div className="mx-auto flex max-w-[1280px] items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" />规则已更新，当前结果待重审。</div>
        </div>
      )}
      {error && <div className="shrink-0 border-b border-red-500/25 bg-red-500/8 px-6 py-2 text-xs text-red-600 dark:text-red-400">{error}</div>}

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-[1280px] overflow-x-auto">
          {activeTab === "sessions" && (sessions.length ? <SessionTable sessions={sessions} onOpenSession={onOpenSession} onAuditSession={(session) => void runSessionAudit(session)} auditingSessionIds={auditingSessionIds} auditDisabled={auditBusy} sort={sorts.sessions} onSort={(key, direction) => changeSort("sessions", key, direction)} /> : <EmptyState tab={activeTab} onRun={() => void runFullAudit()} />)}
          {activeTab === "findings" && (findings.length ? <FindingsTable findings={findings} selectedIds={selectedFindingIds} onToggleSelected={(id, selected) => setSelectedFindingIds((current) => { const next = new Set(current); if (selected) next.add(id); else next.delete(id); return next; })} onToggleAll={(selected) => setSelectedFindingIds((current) => { const next = new Set(current); findings.forEach((finding) => { if (selected) next.add(finding.id); else next.delete(finding.id); }); return next; })} onOpenSession={onOpenSession} onLocateTool={onLocateTool} onStatusChange={(finding, status) => void updateFinding(finding, status)} sort={sorts.findings} onSort={(key, direction) => changeSort("findings", key, direction)} /> : <EmptyState tab={activeTab} onRun={() => void runFullAudit()} />)}
          {activeTab === "tools" && (tools.length ? <ToolsTable tools={tools} onLocateTool={onLocateTool} sort={sorts.tools} onSort={(key, direction) => changeSort("tools", key, direction)} /> : <EmptyState tab={activeTab} onRun={() => void runFullAudit()} />)}
          {activeTab === "events" && (auditEvents.length ? <AuditEventsTable events={auditEvents} onOpen={(event) => void openEvent(event)} sort={sorts.events} onSort={(key, direction) => changeSort("events", key, direction)} /> : <EmptyState tab={activeTab} onRun={() => void runFullAudit()} />)}
          {activeTab === "rules" && <RulesTable rules={rules} onUpdate={(rule, patch) => void updateRule(rule, patch)} onEdit={setEditingRule} sort={sorts.rules} onSort={(key, direction) => changeSort("rules", key, direction)} />}
          {activeTab === "runs" && (
            runs.length ? <RunsTable runs={runs} sort={sorts.runs} onSort={(key, direction) => changeSort("runs", key, direction)} /> : <EmptyState tab={activeTab} onRun={() => void runFullAudit()} />
          )}
        </div>
      </ScrollArea>

      {editingRule && <RuleEditor rule={editingRule} onClose={() => setEditingRule(null)} onSave={(config) => updateRule(editingRule, { config }, true)} />}
      {selectedEvent && <AuditEventViewer event={selectedEvent} detail={eventDetail} loading={eventLoading} onClose={() => { setSelectedEvent(null); setEventDetail(null); }} />}
    </div>
  );
}
