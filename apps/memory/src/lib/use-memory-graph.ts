import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraphInput, MemoryGraph } from '../contracts'
import { readGraph } from './api'

export function useMemoryGraph(input: GraphInput, available: boolean) {
  const [graph, setGraph] = useState<MemoryGraph | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const { query, entityType, offset } = input
  const refresh = useCallback(async (silent = false) => {
    if (!available || (silent && pending.current)) return
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    if (!silent) setLoading(true)
    try {
      const next = await readGraph({ query, entityType, offset }, controller.signal)
      if (controller.signal.aborted) return
      setGraph(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
      setError('')
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '图谱读取失败，请重试。')
    } finally {
      if (pending.current === controller) { pending.current = null; setLoading(false) }
    }
  }, [available, query, entityType, offset])
  useEffect(() => {
    void refresh()
    const onFocus = () => { if (!document.hidden) void refresh(true) }
    const interval = window.setInterval(onFocus, 10_000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const off = window.mossApp?.events.on('memory.changed', onFocus)
    return () => {
      pending.current?.abort(); pending.current = null
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      off?.()
    }
  }, [refresh])
  return { graph, error, loading, refresh }
}
