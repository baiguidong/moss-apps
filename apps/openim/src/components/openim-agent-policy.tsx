"use client";

import * as React from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type {
  AgentBindingPatch,
  AgentBindingPolicy,
  AgentHostResultMap,
  AgentReplyMode,
  AgentSessionMode,
} from "@moss/app-sdk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { openIMDefaultConversationIdFor } from "@/lib/conversation-identifiers";

type CatalogItem = {
  id: string;
  name?: string;
  title?: string;
  displayName?: string;
  description?: string;
  connected?: boolean;
};

type AgentCatalog = {
  agents: CatalogItem[];
  tools: CatalogItem[];
  skills: CatalogItem[];
  connectors: CatalogItem[];
};

type BindingResult = AgentHostResultMap["binding.get"] & {
  effective: AgentBindingPolicy & {
    unavailableResources?: Partial<Record<"agents" | "tools" | "skills" | "connectors", string[]>>;
  };
};

type TurnRecord = {
  id: string;
  externalConversationId: string;
  status: string;
  resultText?: string;
  reviewedText?: string;
  createdAt?: number;
  input?: { message?: { text?: string } };
};

type PolicyDraft = {
  replyMode: Exclude<AgentReplyMode, "inherit" | "mention_only">;
  agentId: string;
  permissionMode: AgentBindingPolicy["permissionMode"];
  resources: Record<"tools" | "skills" | "connectors", string[] | null>;
  sessionMode: AgentSessionMode;
  rotateAfterTurns: number;
  proactive: AgentBindingPolicy["proactive"];
};

export type OpenIMPolicyTarget = {
  conversationId: string;
  title: string;
  kind: "default" | "contact";
  peerId?: string;
};

const EMPTY_CATALOG: AgentCatalog = { agents: [], tools: [], skills: [], connectors: [] };
const MOSS_AGENT_PROTOCOL = "moss.agent/v1";
const MOSS_CHANNEL_PROTOCOL = "moss.channel/v1";
const RESOURCE_LABELS = {
  tools: ["工具", "决定 Agent 可以调用哪些内置或 App 工具"],
  skills: ["技能", "决定 Agent 可以加载哪些已安装技能"],
  connectors: ["Connector", "决定 Agent 可以访问哪些外部服务"],
} as const;

const REPLY_MODES: Array<{
  value: PolicyDraft["replyMode"];
  title: string;
  description: string;
}> = [
  { value: "human_only", title: "人工回复", description: "AI 不生成也不发送回复" },
  { value: "ai_draft_review", title: "AI 起草，人工确认", description: "草稿只在本机显示，批准后才发给对方" },
  { value: "ai_auto", title: "AI 自动回复", description: "生成完成后直接发送给对方" },
];

function itemId(item: CatalogItem) {
  return String(item.id || item.name || "").trim();
}

function itemTitle(item: CatalogItem) {
  return String(item.displayName || item.title || item.name || item.id || "").trim();
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))]
    : [];
}

function normalizeCatalog(value: unknown): AgentCatalog {
  const source = record(value);
  return {
    agents: Array.isArray(source.agents) ? source.agents.map(record).map((item) => item as CatalogItem) : [],
    tools: Array.isArray(source.tools) ? source.tools.map(record).map((item) => item as CatalogItem) : [],
    skills: Array.isArray(source.skills) ? source.skills.map(record).map((item) => ({
      ...item,
      id: String(item.name || item.id || ""),
    }) as CatalogItem) : [],
    connectors: Array.isArray(source.connectors) ? source.connectors.map(record).map((item) => item as CatalogItem) : [],
  };
}

function normalizeDraft(result: BindingResult): PolicyDraft {
  const effective = result.effective;
  const unavailable = effective.unavailableResources || {};
  const resources = (key: "tools" | "skills" | "connectors") => {
    if (effective.resources?.[key] === null) return null;
    return [...new Set([
      ...stringList(effective.resources?.[key]),
      ...stringList(unavailable[key]),
    ])];
  };
  const replyMode = ["human_only", "ai_draft_review", "ai_auto"].includes(effective.replyMode)
    ? effective.replyMode as PolicyDraft["replyMode"]
    : "human_only";
  return {
    replyMode,
    agentId: String(effective.agentId || ""),
    permissionMode: effective.permissionMode || "default",
    resources: {
      tools: resources("tools"),
      skills: resources("skills"),
      connectors: resources("connectors"),
    },
    sessionMode: effective.session?.mode || "fixed",
    rotateAfterTurns: Number(effective.session?.rotateAfterTurns) || 24,
    proactive: {
      enabled: effective.proactive?.enabled === true,
      maxConsecutiveReplies: Number(effective.proactive?.maxConsecutiveReplies) || 1,
      cooldownMs: Number(effective.proactive?.cooldownMs) || 30_000,
    },
  };
}

function draftPatch(draft: PolicyDraft, customContact: boolean): AgentBindingPatch {
  return {
    ...(customContact ? { inheritDefault: false } : {}),
    replyMode: draft.replyMode,
    agentId: draft.agentId || null,
    permissionMode: draft.permissionMode,
    resources: {
      tools: draft.resources.tools,
      skills: draft.resources.skills,
      connectors: draft.resources.connectors,
    },
    session: {
      mode: draft.sessionMode,
      rotateAfterTurns: Math.max(1, Math.min(1000, Math.round(draft.rotateAfterTurns) || 24)),
    },
    proactive: draft.proactive,
  };
}

async function agentRequest<T>(
  instanceId: string,
  method: string,
  input: Record<string, unknown>,
) {
  return window.mossApp.host.request<T>(instanceId, MOSS_AGENT_PROTOCOL, method, input);
}

async function channelRequest<T>(
  instanceId: string,
  method: string,
  input: Record<string, unknown>,
) {
  return window.mossApp.host.request<T>(instanceId, MOSS_CHANNEL_PROTOCOL, method, input);
}

async function cancelConversationTurns(instanceId: string, conversationId: string) {
  const result = await agentRequest<AgentHostResultMap["turn.list"]>(instanceId, "turn.list", {
    externalConversationId: conversationId,
    statuses: ["queued", "running", "awaiting_review"],
    limit: 100,
  });
  await Promise.allSettled((result.turns || []).map((raw) => {
    const turn = record(raw);
    return turn.id
      ? agentRequest(instanceId, "turn.abort", { turnId: String(turn.id) })
      : Promise.resolve();
  }));
}

function ChoiceCard({
  checked,
  title,
  description,
  warning = false,
  onChange,
}: {
  checked: boolean;
  title: string;
  description: string;
  warning?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "flex min-h-16 flex-1 items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        checked ? "border-primary bg-primary/8" : "border-border bg-background hover:bg-muted/50",
      )}
    >
      <span className={cn(
        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
      )}>{checked ? <Check className="h-3 w-3" /> : null}</span>
      <span className="min-w-0">
        <span className={cn("block text-xs font-medium", warning && "text-amber-700 dark:text-amber-300")}>{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function ResourceEditor({
  kind,
  items,
  value,
  onChange,
}: {
  kind: keyof typeof RESOURCE_LABELS;
  items: CatalogItem[];
  value: string[] | null;
  onChange: (value: string[] | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const selected = new Set(value || []);
  const known = new Set(items.map(itemId));
  const unavailable = (value || []).filter((id) => !known.has(id));
  const filtered = items.filter((item) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${itemTitle(item)} ${item.description || ""}`.toLowerCase().includes(needle);
  });
  const [title, description] = RESOURCE_LABELS[kind];

  return (
    <div className="rounded-lg border border-border bg-background">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {value === null ? "全部" : `${value.length} 项`}
        </span>
      </button>
      {open ? (
        <div className="border-t border-border px-3 pb-3 pt-2">
          <div className="mb-2 flex rounded-md bg-muted p-0.5">
            <button type="button" className={cn("flex-1 rounded px-2 py-1 text-[11px]", value !== null && "bg-background font-medium shadow-sm")} onClick={() => onChange(value || [])}>仅选择项</button>
            <button type="button" className={cn("flex-1 rounded px-2 py-1 text-[11px]", value === null && "bg-background font-medium shadow-sm")} onClick={() => onChange(null)}>允许全部</button>
          </div>
          {value !== null ? (
            <>
              {items.length > 8 ? <div className="relative mb-2"><Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-7 pl-7 text-xs" placeholder={`搜索${title}`} /></div> : null}
              <div className="max-h-40 overflow-y-auto rounded-md border border-border/70">
                {filtered.length ? filtered.map((item) => {
                  const id = itemId(item);
                  const checked = selected.has(id);
                  return (
                    <label key={id} className="flex cursor-pointer items-start gap-2 border-b border-border/50 px-2.5 py-2 last:border-0 hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={checked}
                        className="mt-0.5 accent-[var(--primary)]"
                        onChange={() => onChange(checked ? (value || []).filter((entry) => entry !== id) : [...(value || []), id])}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{itemTitle(item)}</span>
                        {item.description ? <span className="line-clamp-2 text-[10px] leading-4 text-muted-foreground">{item.description}</span> : null}
                      </span>
                      {kind === "connectors" && item.connected === false ? <span className="text-[10px] text-muted-foreground">未连接</span> : null}
                    </label>
                  );
                }) : <div className="px-3 py-5 text-center text-xs text-muted-foreground">{query ? "没有匹配项" : `暂无可用${title}`}</div>}
              </div>
              {unavailable.length ? <div className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">不可用但仍保留：{unavailable.join("、")}</div> : null}
            </>
          ) : <div className="text-[11px] leading-5 text-amber-700 dark:text-amber-300">新安装的{title}也会自动获得权限，请仅在确有需要时使用。</div>}
        </div>
      ) : null}
    </div>
  );
}

export function OpenIMAgentPolicyDialog({
  instanceId,
  target,
  onClose,
}: {
  instanceId: string | null;
  target: OpenIMPolicyTarget;
  onClose: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [catalog, setCatalog] = React.useState<AgentCatalog>(EMPTY_CATALOG);
  const [binding, setBinding] = React.useState<BindingResult["binding"]>(null);
  const [draft, setDraft] = React.useState<PolicyDraft | null>(null);
  const [followDefault, setFollowDefault] = React.useState(false);
  const [currentSession, setCurrentSession] = React.useState<Record<string, any> | null>(null);
  const [resettingSession, setResettingSession] = React.useState(false);
  const defaultConversationId = openIMDefaultConversationIdFor(target.conversationId) || undefined;

  const load = React.useCallback(async () => {
    if (!instanceId) {
      setError("OpenIM App 实例尚未启用，请先在 App 管理中启用 Default 实例。");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const peerId = String(target.peerId || "").trim();
      const [catalogResult, bindingResult, sessionResult] = await Promise.all([
        agentRequest<AgentHostResultMap["catalog.list"]>(instanceId, "catalog.list", {}),
        agentRequest<BindingResult>(instanceId, "binding.get", {
          externalConversationId: target.conversationId,
          defaultConversationId,
        }),
        target.kind === "contact" && peerId
          ? channelRequest<Record<string, any>>(instanceId, "conversation.current", {
              externalUserId: peerId,
              externalConversationId: target.conversationId,
            }).catch(() => ({ session: null }))
          : Promise.resolve({ session: null }),
      ]);
      const nextDraft = normalizeDraft(bindingResult);
      if (target.kind === "default" && !bindingResult.binding) {
        nextDraft.sessionMode = "fixed";
      }
      setCatalog(normalizeCatalog(catalogResult));
      setBinding(bindingResult.binding);
      setDraft(nextDraft);
      setFollowDefault(target.kind === "contact" && !bindingResult.binding);
      setCurrentSession(record(sessionResult).session || null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [defaultConversationId, instanceId, target.conversationId, target.kind]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const save = async () => {
    if (!instanceId || !draft) return;
    setSaving(true);
    setError("");
    try {
      if (target.kind === "contact" && followDefault) {
        await agentRequest(instanceId, "binding.reset", {
          externalConversationId: target.conversationId,
          defaultConversationId,
          expectedRevision: binding?.revision || 0,
        });
      } else {
        await agentRequest(instanceId, "binding.update", {
          externalConversationId: target.conversationId,
          defaultConversationId,
          expectedRevision: binding?.revision || 0,
          patch: draftPatch(draft, target.kind === "contact"),
        });
      }
      if (target.kind === "contact") {
        await cancelConversationTurns(instanceId, target.conversationId);
        window.dispatchEvent(new Event("openim:agent-turns-changed"));
      }
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const resetSession = async () => {
    if (!instanceId || target.kind !== "contact") return;
    if (!window.confirm(`为“${target.title}”创建新的 AI 上下文？旧会话和审计记录会保留。`)) return;
    const peerId = String(target.peerId || "").trim();
    if (!peerId) {
      setError("联系人标识无效，无法重置 AI 上下文。");
      return;
    }
    setResettingSession(true);
    setError("");
    try {
      const result = await channelRequest<Record<string, any>>(instanceId, "conversation.create", {
        externalUserId: peerId,
        externalConversationId: target.conversationId,
        externalEventId: `context-reset:${crypto.randomUUID()}`,
        title: `${target.title} · OpenIM`,
      });
      setCurrentSession(record(result).session || null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setResettingSession(false);
    }
  };

  const setResource = (kind: keyof PolicyDraft["resources"], value: string[] | null) => {
    setDraft((current) => current ? {
      ...current,
      resources: { ...current.resources, [kind]: value },
    } : current);
  };

  const unavailableAgentId = draft?.agentId && !catalog.agents.some((agent) => itemId(agent) === draft.agentId)
    ? draft.agentId
    : "";

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm" onMouseDown={() => !saving && onClose()}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bot className="h-4.5 w-4.5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{target.kind === "default" ? "默认 AI 回复策略" : `${target.title} · AI 回复策略`}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{target.kind === "default" ? "新联系人默认使用此模板，每个联系人仍可单独覆盖。" : "此设置只影响你与该联系人的单聊。"}</p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" disabled={saving} title="关闭" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载策略</div> : null}
          {!loading && error && !draft ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-8 text-center">
              <AlertTriangle className="mb-3 h-6 w-6 text-destructive" />
              <div className="max-w-lg text-sm text-destructive">{error}</div>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void load()}><RotateCcw className="h-3.5 w-3.5" />重试</Button>
            </div>
          ) : null}
          {!loading && draft ? (
            <div className="space-y-5">
              {target.kind === "contact" ? (
                <section>
                  <div className="mb-2 text-xs font-medium">策略来源</div>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="策略来源">
                    <ChoiceCard checked={followDefault} title="跟随默认策略" description="默认策略变化时，此联系人同步变化" onChange={() => setFollowDefault(true)} />
                    <ChoiceCard checked={!followDefault} title="联系人独立策略" description="完整覆盖默认值，之后可单独调整" onChange={() => setFollowDefault(false)} />
                  </div>
                </section>
              ) : null}

              <fieldset disabled={followDefault} className={cn("space-y-5", followDefault && "opacity-45")}>
                <section>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium"><Sparkles className="h-3.5 w-3.5 text-primary" />回复方式</div>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="回复方式">
                    {REPLY_MODES.map((mode) => <ChoiceCard key={mode.value} checked={draft.replyMode === mode.value} title={mode.title} description={mode.description} warning={mode.value === "ai_auto"} onChange={() => setDraft({ ...draft, replyMode: mode.value })} />)}
                  </div>
                  {draft.replyMode === "ai_auto" ? <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />AI 生成的内容会直接发送。建议先用“AI 起草，人工确认”验证 Agent 和权限配置。</div> : null}
                </section>

                <section className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium">Agent</span>
                    <select value={draft.agentId} onChange={(event) => setDraft({ ...draft, agentId: event.target.value })} className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30">
                      <option value="">Moss 默认 Agent</option>
                      {unavailableAgentId ? <option value={unavailableAgentId}>{unavailableAgentId}（不可用）</option> : null}
                      {catalog.agents.map((agent) => <option key={itemId(agent)} value={itemId(agent)}>{itemTitle(agent)}</option>)}
                    </select>
                    <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">指定后由该 Agent 协调本次回复；留空使用默认对话 Agent。</span>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium"><ShieldCheck className="h-3.5 w-3.5 text-primary" />操作权限</span>
                    <select value={draft.permissionMode} onChange={(event) => setDraft({ ...draft, permissionMode: event.target.value as PolicyDraft["permissionMode"] })} className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/30">
                      <option value="default">标准确认</option>
                      <option value="acceptEdits">自动接受文件编辑</option>
                      <option value="dontAsk">仅执行无需询问的操作</option>
                    </select>
                    <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">无法在后台确认的敏感操作会停下，等待你回到 Moss 处理。</span>
                  </label>
                </section>

                <section>
                  <div className="mb-2 text-xs font-medium">可用能力</div>
                  <div className="space-y-2">
                    {(["tools", "skills", "connectors"] as const).map((kind) => (
                      <ResourceEditor key={kind} kind={kind} items={catalog[kind]} value={draft.resources[kind]} onChange={(value) => setResource(kind, value)} />
                    ))}
                  </div>
                </section>

                <section>
                  <div className="mb-2 text-xs font-medium">Agent 会话</div>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Agent 会话">
                    <ChoiceCard checked={draft.sessionMode === "fixed"} title="固定长期会话" description="保留上下文，由 Moss Core 自动压缩" onChange={() => setDraft({ ...draft, sessionMode: "fixed" })} />
                    <ChoiceCard checked={draft.sessionMode === "rotating"} title="定期轮换" description="达到轮次后携带摘要创建新会话" onChange={() => setDraft({ ...draft, sessionMode: "rotating" })} />
                    <ChoiceCard checked={draft.sessionMode === "new_each_turn"} title="每条消息新会话" description="每次独立处理，不继承此前上下文" onChange={() => setDraft({ ...draft, sessionMode: "new_each_turn" })} />
                  </div>
                  {draft.sessionMode === "rotating" ? <label className="mt-3 flex items-center gap-3 text-xs"><span className="text-muted-foreground">每</span><Input type="number" min={1} max={1000} value={draft.rotateAfterTurns} onChange={(event) => setDraft({ ...draft, rotateAfterTurns: Number(event.target.value) })} className="h-8 w-24" /><span className="text-muted-foreground">次 AI 回复后轮换</span></label> : null}
                </section>
              </fieldset>

              {target.kind === "contact" ? <section><div className="mb-2 text-xs font-medium">当前 AI 上下文</div><div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2.5"><div className="min-w-0"><div className="truncate text-xs font-medium">{currentSession?.title || "尚未创建 AI 上下文"}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{currentSession?.id ? `Session ${currentSession.id}` : "收到首条需要 AI 处理的消息时自动创建"}</div></div><Button type="button" variant="outline" size="sm" disabled={resettingSession} onClick={() => void resetSession()}>{resettingSession ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}重置上下文</Button></div></section> : null}

              {error ? <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border bg-muted/20 px-5 py-3">
          <p className="max-w-xl text-[10px] leading-4 text-muted-foreground">策略按 OpenIM 联系人保存在当前设备；每个联系人使用独立的 Moss Agent 会话，长期会话由 Core 自动压缩。</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>取消</Button>
            <Button type="button" size="sm" disabled={loading || saving || !draft || !instanceId} onClick={() => void save()}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}保存</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDraftTime(timestamp?: number) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function OpenIMPendingReviews({
  instanceId,
  conversationId,
}: {
  instanceId: string | null;
  conversationId: string;
}) {
  const [turns, setTurns] = React.useState<TurnRecord[]>([]);
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [busyTurnId, setBusyTurnId] = React.useState("");
  const [error, setError] = React.useState("");

  const refresh = React.useCallback(async () => {
    if (!instanceId || !conversationId) {
      setTurns([]);
      return;
    }
    try {
      const result = await agentRequest<AgentHostResultMap["turn.list"]>(instanceId, "turn.list", {
        externalConversationId: conversationId,
        statuses: ["awaiting_review"],
        limit: 100,
      });
      const next = (result.turns || []).map((turn) => record(turn) as TurnRecord);
      setTurns(next);
      setDrafts((current) => Object.fromEntries(next.map((turn) => [
        turn.id,
        Object.hasOwn(current, turn.id) ? current[turn.id] : String(turn.resultText || ""),
      ])));
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [conversationId, instanceId]);

  React.useEffect(() => {
    void refresh();
    const reload = () => void refresh();
    const unsubscribeRequested = window.mossApp.events.on("ai.review-requested", reload);
    const unsubscribeUpdated = window.mossApp.events.on("ai.turn-updated", reload);
    window.addEventListener("openim:agent-turns-changed", reload);
    return () => {
      unsubscribeRequested?.();
      unsubscribeUpdated?.();
      window.removeEventListener("openim:agent-turns-changed", reload);
    };
  }, [refresh]);

  const review = async (turn: TurnRecord, action: "approve" | "reject") => {
    if (!instanceId) return;
    setBusyTurnId(turn.id);
    setError("");
    try {
      await agentRequest(instanceId, "turn.review", {
        turnId: turn.id,
        action,
        ...(action === "approve" ? { text: drafts[turn.id] || "" } : {}),
      });
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyTurnId("");
    }
  };

  if (!turns.length && !error) return null;
  const turn = turns[0];
  if (!turn) return <div className="shrink-0 border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">草稿状态刷新失败：{error}</div>;

  return (
    <div className="shrink-0 border-t border-amber-500/25 bg-amber-500/5 px-4 py-3">
      <div className="mb-2 flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium"><span>AI 回复草稿</span>{turns.length > 1 ? <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px]">待确认 {turns.length}</span> : null}<span className="text-[10px] font-normal text-muted-foreground">{formatDraftTime(turn.createdAt)}</span></div>
          {turn.input?.message?.text ? <div className="mt-0.5 truncate text-[10px] text-muted-foreground">对方：{turn.input.message.text}</div> : null}
        </div>
      </div>
      <Textarea value={drafts[turn.id] || ""} onChange={(event) => setDrafts((current) => ({ ...current, [turn.id]: event.target.value }))} className="min-h-20 resize-y bg-background text-xs leading-5" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[10px] text-destructive">{error}</span>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" disabled={Boolean(busyTurnId)} onClick={() => void review(turn, "reject")}>不发送</Button>
          <Button type="button" size="sm" disabled={Boolean(busyTurnId) || !(drafts[turn.id] || "").trim()} onClick={() => void review(turn, "approve")}>{busyTurnId === turn.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}确认并发送</Button>
        </div>
      </div>
    </div>
  );
}

export function OpenIMAgentActivity({
  instanceId,
  conversationId,
}: {
  instanceId: string | null;
  conversationId: string;
}) {
  const [activity, setActivity] = React.useState<{ status: string; error?: string } | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const update = (raw: unknown) => {
      const data = record(raw);
      if (String(data.conversationId || data.externalConversationId || "") !== conversationId) return;
      const status = String(data.status || "");
      if (["completed", "human", "rejected", "cancelled"].includes(status)) {
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => !disposed && setActivity(null), 1_500);
        return;
      }
      if (status) setActivity({ status, error: String(data.error || "") });
    };
    if (instanceId) {
      void agentRequest<AgentHostResultMap["turn.list"]>(instanceId, "turn.list", {
        externalConversationId: conversationId,
        statuses: ["queued", "running"],
        limit: 1,
      }).then((result) => {
        const turn = record(result.turns?.[0]);
        if (!disposed && turn.status) setActivity({ status: String(turn.status) });
      }).catch(() => {});
    }
    const unsubscribeUpdated = window.mossApp.events.on("ai.turn-updated", update);
    const unsubscribeReview = window.mossApp.events.on("ai.review-requested", update);
    return () => {
      disposed = true;
      if (clearTimer) clearTimeout(clearTimer);
      unsubscribeUpdated?.();
      unsubscribeReview?.();
    };
  }, [conversationId, instanceId]);

  if (!activity) return null;
  if (activity.status === "failed") {
    return <span className="flex max-w-40 items-center gap-1 truncate rounded-full bg-destructive/10 px-2 py-1 text-[10px] text-destructive" title={activity.error || "AI 处理失败"}><AlertTriangle className="h-3 w-3" />AI 处理失败</span>;
  }
  if (activity.status === "delivery_failed") {
    return <span className="flex max-w-40 items-center gap-1 truncate rounded-full bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300" title={activity.error || "自动发送失败，正在重试"}><RotateCcw className="h-3 w-3" />发送失败，重试中</span>;
  }
  if (activity.status === "awaiting_review") return null;
  return <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10px] text-primary"><Loader2 className="h-3 w-3 animate-spin" />AI 正在处理</span>;
}
