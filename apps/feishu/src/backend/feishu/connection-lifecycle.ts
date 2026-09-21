type ReportConnection = (
  connected: boolean,
  error?: unknown,
  required?: boolean,
) => void | Promise<void>

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Bridges the Feishu SDK connection callbacks to the Moss Host lifecycle.
 * WSClient.start() resolves before its first WebSocket connection, so Backend
 * readiness must wait for onReady and for the Host to acknowledge that state.
 */
export function createFeishuConnectionLifecycle(reportConnection: ReportConnection) {
  let initialSettled = false
  let initialReportStarted = false
  let reportQueue = Promise.resolve()
  let resolveInitial!: () => void
  let rejectInitial!: (error: Error) => void
  const initialReady = new Promise<void>((resolve, reject) => {
    resolveInitial = resolve
    rejectInitial = reject
  })

  const settleReady = (): void => {
    if (initialSettled) return
    initialSettled = true
    resolveInitial()
  }
  const settleError = (error: unknown): void => {
    if (initialSettled) return
    initialSettled = true
    rejectInitial(normalizeError(error))
  }
  const enqueueReport = (
    connected: boolean,
    error?: unknown,
    required?: boolean,
  ): Promise<void> => {
    const report = reportQueue
      .catch(() => {})
      .then(() => reportConnection(connected, error, required))
    reportQueue = report.catch(() => {})
    return report
  }

  return {
    initialReady,
    onReady(): void {
      if (initialSettled || initialReportStarted) return
      initialReportStarted = true
      void enqueueReport(true, undefined, true)
        .then(settleReady, settleError)
    },
    onError(error: unknown): void {
      void enqueueReport(false, error)
      settleError(error)
    },
    onReconnecting(): void {
      void enqueueReport(false, 'Feishu WebSocket reconnecting')
    },
    onReconnected(): void {
      void enqueueReport(true)
    },
  }
}
