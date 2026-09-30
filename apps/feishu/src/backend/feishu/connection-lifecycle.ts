type ReportConnection = (
  connected: boolean,
  error?: unknown,
) => void | Promise<void>

/**
 * Network state is independent of local Backend readiness. The SDK reconnects
 * in the same process, including when its first connection attempt is offline.
 */
export function createFeishuConnectionLifecycle(reportConnection: ReportConnection) {
  let reportQueue = Promise.resolve()
  const enqueueReport = (connected: boolean, error?: unknown): void => {
    reportQueue = reportQueue
      .then(() => reportConnection(connected, error))
      .catch(() => {})
  }

  return {
    onReady(): void {
      enqueueReport(true)
    },
    onError(error: unknown): void {
      enqueueReport(false, error)
    },
    onReconnecting(): void {
      enqueueReport(false, 'Feishu WebSocket reconnecting')
    },
    onReconnected(): void {
      enqueueReport(true)
    },
  }
}
