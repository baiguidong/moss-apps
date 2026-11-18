import { useEffect, useState } from 'react'
import { request } from './api'

/** Restart a read when its arguments change. Never display a previous query under a new filter. */
export function useQuery<T>(action: string, input: Record<string, unknown> = {}, revision = 0): { data?: T; error?: string } {
  const args = JSON.stringify(input)
  const key = JSON.stringify([action, args, revision])
  const [response, setResponse] = useState<{ key: string; data?: T; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    request<T>(action, JSON.parse(args), controller.signal).then(data => {
      if (!controller.signal.aborted) setResponse({ key, data })
    }).catch(error => {
      if (!controller.signal.aborted) setResponse({ key, error: error.message })
    })
    return () => controller.abort()
  }, [action, args, key])
  return response?.key === key ? response : {}
}
