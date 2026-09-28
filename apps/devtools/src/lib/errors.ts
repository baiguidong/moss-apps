export function userError(error: unknown): string {
  const message = (error instanceof Error ? error.message : '').replace(/^Error invoking remote method '[^']+':\s*(?:[A-Za-z]*Error:\s*)?/, '')
  if (/[\u3400-\u9fff]/.test(message)) return message
  if (/disabled|not enabled/i.test(message)) return '应用已停用，请在 Moss 应用管理中启用后重试。'
  if (/backend|runtime|unavailable|disconnected|timeout/i.test(message)) return '暂时无法连接本地服务，请在 Moss 应用管理中检查状态后重试。'
  return '操作失败，请检查输入和参数后重试。'
}
