import * as React from 'react'
// Adapted from cc-haha TraceSession: same timeline and revision polling.
import { useTraceTarget } from './TraceTarget'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  RadioTower,
  RefreshCw,
} from 'lucide-react'
import { createTraceSessionReader } from '@/lib/trace/sessionReader'
import { useTranslation } from '@/lib/trace/i18n'
import type { MessageEntry } from '@/types/trace-session'
import type { TraceSession as TraceSessionData } from '@/types/trace'
import { formatDurationMs, formatTokenCount } from '@/lib/trace/formatters'
import { Button } from './primitives'
import { EmptyState } from './primitives'
import { IconButton } from './primitives'
import { TraceSplitLayout } from './TraceSplitLayout'
import { TraceTree } from './TraceTree'
import { TraceDetail } from './TraceDetail'
import { TraceSectionStateProvider } from './detail/Section'
import { StatusPill, TypeIcon, spanDisplayTitle } from './TraceBadges'
import {
  buildTraceViewModel,
  type TraceSpan,
  type TraceViewModel,
} from '@/lib/trace/viewModel'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; trace: TraceSessionData; messages: MessageEntry[] }

type TraceTranslator = ReturnType<typeof useTranslation>

const TRACE_POLL_INTERVAL_MS = 1500

export function TraceSession({
  sessionId,
  onBack,
  pollIntervalMs = TRACE_POLL_INTERVAL_MS,
}: {
  sessionId: string
  /**
   * Return to the trace list. Omitted in the standalone window, which has no
   * list to go back to.
   */
  onBack?: () => void
  pollIntervalMs?: number
}) {
  const t = useTranslation()
  const target = useTraceTarget()
  const [pollingError, setPollingError] = useState('')
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [clockNowMs, setClockNowMs] = useState(() => Date.now())
  const [revisionKey, setRevisionKey] = useState<string | undefined>()
  const lastSpanIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let loadInFlight = false
    const read = createTraceSessionReader(target, sessionId)

    const load = async (silent: boolean) => {
      if (silent && loadInFlight) return
      loadInFlight = true
      if (!silent) setState({ status: 'loading' })
      try {
        if (silent) setRefreshing(true)
        const result = await read(!silent)
        if (cancelled) return
        setPollingError('')
        setRevisionKey(result.revisionKey)
        if (!result.snapshot) return
        const trace = result.snapshot
        setState({ status: 'ready', trace, messages: trace.messages ?? [] })
        setClockNowMs(Date.now())
      } catch (error) {
        if (cancelled) return
        setPollingError(error instanceof Error ? error.message : String(error))
        if (!silent) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      } finally {
        loadInFlight = false
        if (!cancelled) setRefreshing(false)
      }
    }

    setRevisionKey(undefined)
    setPollingError('')
    setSelectedId(null)
    lastSpanIdRef.current = null
    void load(false)
    const interval = window.setInterval(() => {
      void load(true)
    }, pollIntervalMs)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [target, sessionId, refreshNonce, pollIntervalMs, t])

  const refresh = () => setRefreshNonce((value) => value + 1)

  const readyState = state.status === 'ready' ? state : null
  const viewModel = useMemo(
    () => readyState
      ? buildTraceViewModel(readyState.trace, readyState.messages, { now: new Date(clockNowMs).toISOString() })
      : null,
    [readyState, clockNowMs],
  )

  useEffect(() => {
    if (!viewModel) return
    if (viewModel.diagnosis.pendingModelCalls === 0 && viewModel.diagnosis.pendingToolCalls === 0) return
    const timer = window.setInterval(() => setClockNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [viewModel?.diagnosis.pendingModelCalls, viewModel?.diagnosis.pendingToolCalls])

  useEffect(() => {
    if (!viewModel) return
    const lastSpanId = viewModel.orderedSpanIds.at(-1) ?? null
    setSelectedId((current) => {
      // Follow the live tail only when the user was already reading the tail.
      if (current && current === lastSpanIdRef.current && lastSpanId && current !== lastSpanId) {
        lastSpanIdRef.current = lastSpanId
        return lastSpanId
      }
      lastSpanIdRef.current = lastSpanId
      if (current && viewModel.spansById.has(current)) return current
      return viewModel.rootId
    })
  }, [viewModel])

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]">
        <TraceHeader
          title={t('session.untitled')}
          onBack={onBack}
          onRefresh={refresh}
          refreshing={refreshing}
        />
        <TraceSkeleton />
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]">
        <TraceHeader
          title={t('session.untitled')}
          onBack={onBack}
          onRefresh={refresh}
          refreshing={refreshing}
        />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md rounded-[var(--radius)] border border-[var(--color-error)] bg-[var(--color-error-container)] px-6 py-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <AlertTriangle size={14} strokeWidth={2} />
              {t('trace.loadFailed')}
            </div>
            <p className="mt-2 text-sm text-foreground">{state.message}</p>
            <Button
              variant="secondary"
              size="base"
              className="mt-4"
              onClick={refresh}
              icon={<RefreshCw size={14} strokeWidth={2} />}
            >
              {t('common.retry')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const { trace, messages } = state
  const resolvedTitle = trace.session?.title ?? t('session.untitled')
  if (!viewModel) {
    return <TraceEmpty />
  }

  const hasTraceContent = trace.calls.length > 0 || (trace.events?.length ?? 0) > 0 || messages.length > 0
  const selectedSpan = selectedId ? viewModel.spansById.get(selectedId) : undefined
  const activeSpan = selectedSpan ?? viewModel.spansById.get(viewModel.rootId) ?? viewModel.spans[0] ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <TraceHeader
        title={resolvedTitle}
        trace={trace}
        onBack={onBack}
        onRefresh={refresh}
        refreshing={refreshing}
      />
      {pollingError && <p role="alert" className="border-b border-destructive/20 px-6 py-2 text-xs text-destructive">刷新失败：{pollingError}</p>}
      <DiagnosisBanner viewModel={viewModel} onSelect={setSelectedId} />
      {hasTraceContent && activeSpan ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <TraceSectionStateProvider scopeId={`${target}:${sessionId}`}>
            <TraceSplitLayout
              tree={
                <TraceTree
                  viewModel={viewModel}
                  selectedId={activeSpan.id}
                  onSelect={setSelectedId}
                />
              }
              detail={
                <TraceDetail
                  span={activeSpan}
                  viewModel={viewModel}
                  sessionId={sessionId}
                  revisionKey={revisionKey}
                  onSelect={setSelectedId}
                />
              }
            />
          </TraceSectionStateProvider>
        </div>
      ) : (
        <TraceEmpty />
      )}
    </div>
  )
}

function TraceHeader({
  title,
  trace,
  onBack,
  onRefresh,
  refreshing = false,
}: {
  title: string
  trace?: TraceSessionData
  onBack?: () => void
  onRefresh?: () => void
  refreshing?: boolean
}) {
  const t = useTranslation()
  const summary = trace?.summary

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-3 border-b px-4"
      data-testid="trace-header"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onBack ? (
          <IconButton
            className="shrink-0 text-muted-foreground"
            label={t('trace.backToList')}
            onClick={onBack}
            icon={<ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />}
            data-testid="trace-back"
          />
        ) : null}
        <h1 className="min-w-0 truncate text-sm font-semibold" title={title}>
          {title}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {summary ? (
          <div className="hidden items-center gap-3 whitespace-nowrap text-xs tabular-nums text-muted-foreground md:flex">
            <span>{summary.apiCalls} 次调用</span>
            {summary.failedCalls > 0 ? (
              <span className="text-destructive">{summary.failedCalls} 次失败</span>
            ) : null}
            <span title={t('trace.modelTime')}>{formatDurationMs(summary.totalDurationMs)}</span>
            <span title={t('trace.tokens')}>{formatTokenCount(summary.totalInputTokens + summary.totalOutputTokens)} tokens</span>
          </div>
        ) : null}
        <IconButton
          className="shrink-0 text-muted-foreground"
          label={t('trace.refresh')}
          onClick={onRefresh}
          icon={<RefreshCw size={14} strokeWidth={2} className={refreshing ? 'animate-spin' : ''} />}
        />
      </div>
    </header>
  )
}

function DiagnosisBanner({
  viewModel,
  onSelect,
}: {
  viewModel: TraceViewModel
  onSelect: (spanId: string) => void
}) {
  const t = useTranslation()
  const diagnosis = viewModel.diagnosis
  if (diagnosis.status !== 'attention' && diagnosis.status !== 'blocked') return null

  const focusSpan = diagnosis.focusSpanId ? viewModel.spansById.get(diagnosis.focusSpanId) : undefined
  const evidenceSpans = diagnosis.evidenceSpanIds
    .map((spanId) => viewModel.spansById.get(spanId))
    .filter((span): span is TraceSpan => !!span)
    .slice(0, 3)
  // Warning-bar recipe from the redesign spec: `-container` fill, matching
  // `on-*-container` ink, same-tone hairline. No alpha modifiers — Safari 15
  // drops the color function they compile to.
  const toneClass = diagnosis.status === 'blocked'
    ? 'border-[var(--color-error)] bg-[var(--color-error-container)] text-foreground'
    : 'border-[var(--color-warning)] bg-[var(--secondary)] text-[var(--foreground)]'

  return (
    <section className={`flex shrink-0 items-center gap-2.5 border-b px-6 py-2 ${toneClass}`} data-testid="trace-diagnosis">
      <StatusPill status={diagnosis.status === 'blocked' ? 'error' : 'pending'} />
      <span className="min-w-0 truncate text-[12.5px] font-semibold">
        {diagnosisReasonLabel(diagnosis.reason, t)}
      </span>
      {focusSpan ? (
        <Button
          variant="secondary"
          size="xs"
          className="shrink-0"
          onClick={() => onSelect(focusSpan.id)}
        >
          {t('trace.focus')}
        </Button>
      ) : null}
      <div className="ml-auto flex min-w-0 items-center justify-end gap-1.5 overflow-hidden">
        {evidenceSpans.map((span) => (
          <Button
            key={span.id}
            variant="secondary"
            size="xs"
            className="max-w-[200px]"
            onClick={() => onSelect(span.id)}
            icon={<TypeIcon span={span} size={13} />}
          >
            <span className="truncate">{spanDisplayTitle(span, t)}</span>
          </Button>
        ))}
      </div>
    </section>
  )
}

function diagnosisReasonLabel(reason: TraceViewModel['diagnosis']['reason'], t: TraceTranslator): string {
  switch (reason) {
    case 'model_error': return t('trace.diagnosis.modelError')
    case 'tool_error': return t('trace.diagnosis.toolError')
    case 'event_error': return t('trace.diagnosis.eventError')
    case 'pending_model': return t('trace.diagnosis.pendingModel')
    case 'pending_tool': return t('trace.diagnosis.pendingTool')
    case 'waiting_for_agent': return t('trace.diagnosis.waitingForAgent')
    case 'empty': return t('trace.diagnosis.empty')
    default: return t('trace.diagnosis.healthy')
  }
}

function TraceSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row" data-testid="trace-skeleton">
      <div className="shrink-0 border-b border-[var(--border)] bg-[var(--color-surface-container-low)] p-4 lg:w-[400px] lg:border-b-0 lg:border-r">
        <div className="h-8 animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-container)]" />
        <div className="mt-3 space-y-1.5">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="h-[34px] animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-container)]" />
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 p-6">
        <div className="h-5 w-64 animate-pulse rounded bg-[var(--color-surface-container)]" />
        <div className="mt-2 h-3 w-96 animate-pulse rounded bg-[var(--color-surface-container)]" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-container)]" />
          ))}
        </div>
      </div>
    </div>
  )
}

function TraceEmpty() {
  const t = useTranslation()
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <EmptyState
        className="max-w-sm"
        headingLevel={2}
        icon={<RadioTower size={20} strokeWidth={2} />}
        title={t('trace.emptyTitle')}
        description={t('trace.emptyBody')}
      />
    </div>
  )
}
