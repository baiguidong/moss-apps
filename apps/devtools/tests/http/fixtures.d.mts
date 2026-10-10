export function createTestServer(): Promise<{
  url: string
  requests: { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }[]
  closedSlowRequests: () => number
  close: () => Promise<void>
}>
