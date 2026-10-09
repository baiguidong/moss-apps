import * as React from 'react'
// cc-haha Trace list composition, driven by the App Backend.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Trash2, Workflow } from 'lucide-react'
import { tracesApi } from '@/lib/trace/api'
import { createTraceListReader } from '@/lib/trace/listReader'
import { useTranslation } from '@/lib/trace/i18n'
import { clearTraceCallCache } from '@/lib/trace/callCache'
import type { TraceSessionList, TraceSessionListItem } from '@/types/trace'
import { formatDurationMs, formatTokenCount } from '@/lib/trace/formatters'
import { Badge, Button, EmptyState, ErrorState, IconButton, SearchField } from './primitives'
import { useTraceTarget } from './TraceTarget'

type ListState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: TraceSessionList }
const PAGE_SIZE = 50
const MAX_MODEL_CHIPS = 2

export function TraceList({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const t = useTranslation()
  const target = useTraceTarget()
  const [state, setState] = useState<ListState>({ status: 'loading' })
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const reader = useMemo(() => createTraceListReader(target, query), [target, query])
  const [loadingMore, setLoadingMore] = useState(false)
  const [actionError, setActionError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<TraceSessionListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(deleting)
  deletingRef.current = deleting
  const generation = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state
  const activeTarget = useRef(target)
  activeTarget.current = target

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [queryInput])

  const load = useCallback(async ({ append = false, silent = false }: { append?: boolean; silent?: boolean } = {}) => {
    if (reader.busy || (silent && deletingRef.current)) return
    const request = ++generation.current
    const previous = stateRef.current
    const limit = append ? PAGE_SIZE : previous.status === 'ready' ? Math.max(PAGE_SIZE, previous.data.traces.length) : PAGE_SIZE
    const offset = append && previous.status === 'ready' ? previous.data.traces.length : 0
    if (append) setLoadingMore(true)
    else if (!silent) setState({ status: 'loading' })
    try {
      const data = await reader.read({ limit, offset })
      if (!data) return
      if (request !== generation.current) return
      setState({ status: 'ready', data: append && previous.status === 'ready'
        ? { ...data, traces: [...previous.data.traces, ...data.traces].filter((item, index, all) => all.findIndex((other) => other.sessionId === item.sessionId) === index) }
        : data })
      setActionError('')
    } catch (error) {
      if (request !== generation.current) return
      const message = error instanceof Error ? error.message : String(error)
      if (silent && previous.status === 'ready') setActionError(message)
      else setState({ status: 'error', message })
    } finally {
      if (request === generation.current) setLoadingMore(false)
    }
  }, [reader])

  useEffect(() => {
    let cancelled = false
    setActionError('')
    setDeleteTarget(null)
    // A StrictMode effect replay must wait for the discarded effect's read,
    // then start its own load instead of remaining stuck behind the busy guard.
    void reader.waitForIdle().then(() => { if (!cancelled) void load() })
    const interval = window.setInterval(() => {
      // Reconcile with files written while this page was closed.
      if (!document.hidden) void load({ silent: true })
    }, 5000)
    return () => { cancelled = true; ++generation.current; window.clearInterval(interval) }
  }, [load, reader])

  const summary = useMemo(() => {
    if (state.status !== 'ready') return { apiCalls: 0, failedCalls: 0, models: 0 }
    return {
      apiCalls: state.data.traces.reduce((sum, item) => sum + item.summary.apiCalls, 0),
      failedCalls: state.data.traces.reduce((sum, item) => sum + item.summary.failedCalls, 0),
      models: new Set(state.data.traces.flatMap((item) => item.summary.models.map((model) => model.model))).size,
    }
  }, [state])

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await tracesApi.deleteSession(target, deleteTarget.sessionId)
      if (activeTarget.current !== target) return
      clearTraceCallCache()
      setDeleteTarget(null)
      await reader.waitForIdle()
      if (activeTarget.current !== target) return
      await load()
    } catch (error) {
      if (activeTarget.current === target) setActionError(error instanceof Error ? error.message : String(error))
    } finally { if (activeTarget.current === target) setDeleting(false) }
  }

  return <div className="flex min-h-0 flex-1 flex-col bg-background" data-testid="trace-list">
    <header className="shrink-0 border-b px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><Workflow className="size-5 text-primary" /><h1 className="text-xl font-semibold">{t('trace.list.title')}</h1>
            {state.status === 'ready' && <Badge tone={state.data.captureStatus.enabled ? 'success' : 'neutral'}>{state.data.captureStatus.enabled ? t('trace.list.collecting') : t('trace.list.paused')}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">查看模型请求、响应、工具调用和异常。</p>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => void load()}><RefreshCw className="size-3.5" />{t('trace.refresh')}</Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">启用 Trace App 后自动记录本地模型请求，停用 App 即停止采集。</p>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        <MetaChip label={t('trace.list.sessions')} value={state.status === 'ready' ? String(state.data.total) : '—'} />
        <MetaChip label={t('trace.apiCalls')} value={String(summary.apiCalls)} />
        <MetaChip label={t('trace.failedCalls')} value={String(summary.failedCalls)} tone={summary.failedCalls ? 'danger' : 'default'} />
        <MetaChip label={t('trace.models')} value={String(summary.models)} />
      </div>
      {state.status === 'ready' && <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground" title={state.data.storageDir}>{state.data.storageDir}</p>}
    </header>
    {state.status === 'ready' && state.data.captureStatus?.error && <p role="alert" className="shrink-0 border-b px-6 py-2 text-sm text-destructive">采集写入异常：{state.data.captureStatus.error}（未保存 {state.data.captureStatus.droppedRecords} 条记录）</p>}
    {actionError && <p role="alert" className="shrink-0 border-b border-destructive/20 px-6 py-2 text-sm text-destructive">{actionError}</p>}
    {deleteTarget && <div role="alertdialog" aria-label={t('trace.list.deleteConfirmTitle')} className="shrink-0 border-b bg-muted px-6 py-4">
      <p className="text-sm font-medium">{t('trace.list.deleteConfirmTitle')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('trace.list.deleteConfirmBody', { title: getTraceTitle(deleteTarget, t) })}</p>
      <div className="mt-3 flex gap-2"><Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? '正在删除…' : t('common.delete')}</Button>
        <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button></div>
    </div>}
    <div className="shrink-0 border-b px-6 py-3"><SearchField value={queryInput} onChange={setQueryInput} label={t('trace.list.searchPlaceholder')}
      clearLabel={t('common.clearSearch')} placeholder={t('trace.list.searchPlaceholder')} containerClassName="max-w-xl" /></div>
    {state.status === 'loading' && <TraceListSkeleton label={t('common.loading')} />}
    {state.status === 'error' && <ErrorState className="m-6" title={t('trace.list.loadFailed')} detail={state.message} onRetry={() => void load()} retryLabel={t('common.retry')} />}
    {state.status === 'ready' && <TraceRows traces={state.data.traces} total={state.data.total} loadingMore={loadingMore}
      deletingSessionId={deleting ? deleteTarget?.sessionId ?? null : null} onLoadMore={() => void load({ append: true, silent: true })} onOpen={onOpen} onDelete={setDeleteTarget} />}
  </div>
}

export function TraceRows({
  loadingMore,
  onLoadMore,
  traces,
  total,
  onOpen,
  onDelete,
  deletingSessionId,
}: {
  loadingMore: boolean
  onLoadMore: () => void
  traces: TraceSessionListItem[]
  total: number
  onOpen: (sessionId: string) => void
  onDelete: (trace: TraceSessionListItem) => void
  deletingSessionId: string | null
}) {
  const t = useTranslation()

  if (traces.length === 0) {
    return (
      <div className="flex flex-1 items-start justify-center px-6 py-10">
        <EmptyState
          className="w-full max-w-md"
          headingLevel={2}
          icon={<Workflow className="h-5 w-5" strokeWidth={2} />}
          title={t('trace.list.emptyTitle')}
          description={t('trace.list.emptyBody')}
        />
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="divide-y divide-[var(--border)]" role="list">
        {traces.map((trace) => (
          <TraceRow
            key={trace.sessionId}
            trace={trace}
            onOpen={onOpen}
            onDelete={onDelete}
            isDeleting={deletingSessionId === trace.sessionId}
          />
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border)] px-6 py-3 text-xs text-[var(--color-text-tertiary)]">
        <span>{t('trace.list.loadedCount', { shown: traces.length, total })}</span>
        {traces.length < total && (
          <Button size="sm" variant="secondary" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? t('common.loading') : t('trace.list.loadMore')}
          </Button>
        )}
      </div>
    </div>
  )
}

function TraceRow({
  trace,
  onOpen,
  onDelete,
  isDeleting,
}: {
  trace: TraceSessionListItem
  onOpen: (sessionId: string) => void
  onDelete: (trace: TraceSessionListItem) => void
  isDeleting: boolean
}) {
  const t = useTranslation()
  const title = getTraceTitle(trace, t)
  const updatedAt = trace.summary.updatedAt ?? trace.fileUpdatedAt
  // The tab is titled with the session alone; the tab bar's trace glyph says
  // what kind of tab it is, so a prefix here would only eat the visible width.
  const open = () => onOpen(trace.sessionId)
  const failedCalls = trace.summary.failedCalls
  const visibleModels = trace.summary.models.slice(0, MAX_MODEL_CHIPS)
  const hiddenModels = trace.summary.models.length - visibleModels.length
  const totalTokens = trace.summary.totalInputTokens + trace.summary.totalOutputTokens


  return (
    <div
      role="listitem"
      aria-label={title}
      className="trace-list-row-cv group flex h-14 cursor-pointer items-center gap-5 px-6 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 flex-1 items-center gap-5 self-stretch bg-transparent p-0 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="min-w-0 truncate text-[15px] font-semibold text-[var(--color-text-primary)]">{title}</span>
            {visibleModels.map((model) => (
              <span
                key={model.model}
                title={`${model.model} x${model.calls}`}
                className="shrink-0 rounded-[var(--radius)] bg-[var(--secondary)] px-2 py-0.5 font-mono text-[11px] font-medium leading-4 text-[var(--primary)]"
              >
                {shortModelName(model.model)}
              </span>
            ))}
            {hiddenModels > 0 && (
              <span className="shrink-0 rounded-[var(--radius)] bg-[var(--color-surface-container-high)] px-2 py-0.5 font-mono text-[11px] font-medium leading-4 text-[var(--color-text-tertiary)]">
                +{hiddenModels}
              </span>
            )}
            {failedCalls > 0 && (
              <span title={t('trace.failedCalls')} className="flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-[var(--color-error)]">
                <span className="h-[7px] w-[7px] rounded-full bg-[var(--color-error)]" aria-hidden="true" />
                <span>{failedCalls}</span>
              </span>
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-[var(--color-text-tertiary)]">
            <span className="shrink-0">{trace.sessionId.slice(0, 8)}</span>
            {trace.session?.projectPath && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate" title={trace.session.projectPath}>{trace.session.projectPath}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{formatUpdatedAt(updatedAt)}</span>
          </div>
        </div>
        <div className="hidden shrink-0 grid-cols-[4.5rem_5rem_4.5rem] xl:grid items-center gap-4">
          <MetricCell label={t('trace.apiCalls')} value={String(trace.summary.apiCalls)} />
          <MetricCell label={t('trace.modelTime')} value={formatDurationMs(trace.summary.totalDurationMs)} />
          <MetricCell label={t('trace.tokens')} value={formatTokenCount(totalTokens)} />
        </div>
      </button>
      {/* Opening the trace is what the row itself does — the row actions are
          only for the two things a click cannot express. */}
      <div className="flex w-8 shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton
          size="sm"
          tone="secondary"
          hoverTone="danger"
          label={t('trace.delete')}
          icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
          disabled={isDeleting}
          onClick={(event) => {
            event.stopPropagation()
            onDelete(trace)
          }}
        />
      </div>
    </div>
  )
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[13px] font-semibold leading-5 text-[var(--color-text-primary)]">{value}</div>
      <div className="truncate text-[11px] leading-4 text-[var(--color-text-tertiary)]" title={label}>{label}</div>
    </div>
  )
}

function MetaChip({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <div className="flex items-baseline gap-1.5 text-[13px]">
      <span className="text-[var(--color-text-secondary)]">{label}</span>
      <span className={`font-semibold tabular-nums ${tone === 'danger' ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'}`}>{value}</span>
    </div>
  )
}

function TraceListSkeleton({ label }: { label: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden" role="status" aria-label={label}>
      <div className="divide-y divide-[var(--border)]" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex h-14 items-center gap-4 px-6">
            <div className="min-w-0 flex-1">
              <div className="h-3 w-48 max-w-full animate-pulse rounded bg-[var(--color-surface-container-high)]" />
              <div className="mt-2 h-2.5 w-72 max-w-full animate-pulse rounded bg-[var(--color-surface-container-low)]" />
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="h-3 w-10 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
              <div className="h-3 w-12 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
              <div className="h-3 w-12 animate-pulse rounded bg-[var(--color-surface-container-high)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function getTraceTitle(trace: TraceSessionListItem, t: ReturnType<typeof useTranslation>): string {
  return trace.session?.title || t('session.untitled')
}

/** `claude-sonnet-4-5-20250929` -> `sonnet-4-5`; non-Claude ids pass through. */
function shortModelName(model: string): string {
  const short = model.replace(/^claude-/i, '').replace(/-\d{8}$/, '')
  return short || model
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}
