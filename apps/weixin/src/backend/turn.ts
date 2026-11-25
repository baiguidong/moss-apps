import { AppServiceError, type AgentHostRequestMap, type AppBackendContext } from '@moss/app-sdk'

export function createTurnSender(context: AppBackendContext, thinking: boolean, tools: boolean) {
  let progressAvailable = true
  const toolAllowlist = Array.isArray(context.config.allowedTools) ? context.config.allowedTools : undefined
  return {
    get progressUnavailable() { return !progressAvailable },
    async start(input: AgentHostRequestMap['turn.start']) {
      const start = (withProgress: boolean) => withProgress || toolAllowlist
        ? context.host.request('moss.agent/v1', 'turn.start', {
            ...input,
            ...(withProgress && { progress: { thinking, tools } }),
            ...(toolAllowlist && { toolAllowlist }),
          })
        : context.agent.request('turn.start', input)
      const withProgress = progressAvailable && (thinking || tools)
      try {
        return await start(withProgress)
      } catch (error) {
        // Only retry an explicit pre-dispatch validation rejection; retain all tool restrictions.
        if (!withProgress || !(error instanceof AppServiceError) || error.code !== 'APP_INVALID_ACTION_INPUT'
          || error.message !== 'turn.start contains an unknown field: progress') throw error
        progressAvailable = false
        return start(false)
      }
    },
  }
}
