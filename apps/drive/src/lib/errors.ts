export class DriveError extends Error {
  constructor(public code: string, message = code) { super(message) }
}

const messages: Record<string, string> = {
  NAME_CONFLICT: '此目录已有同名文件，请调整文件名后重新上传。',
  INVALID_NAME: '名称不能包含斜杠、控制字符，也不能使用“.”或“..”。',
  FOLDER_NOT_EMPTY: '目录内还有文件，请先清空目录。',
  ENOENT: '本地文件或保存目录已不存在，请重新选择。',
  EACCES: '无法访问本地文件，请检查文件和目录权限。',
  DESTINATION_CHANGED: '保存位置已发生变化，请取消任务后重新下载。',
  INCOMPLETE_DOWNLOAD: '下载内容不完整，请重试。',
  TRANSFER_STATE_WRITE_FAILED: 'Moss 无法保存传输记录，请检查本地空间和权限。',
  HOST_STOPPED: 'Moss 已停止传输服务，可在重新打开后继续。',
  APP_HOST_PROTOCOL: '云端返回的数据不符合约定，请检查 Moss 与服务器版本。',
  EEXIST: '保存位置已有同名文件，请重新下载并选择其他名称。',
  QUOTA_EXCEEDED: '云端空间不足，暂时无法上传。',
  STORAGE_FULL: '存储空间不足，请清理空间后重试。',
  ENOSPC: '本地磁盘空间不足，请清理后继续。',
  FILE_NOT_FOUND: '文件已不存在，请刷新列表。',
  INVALID_HANDLE: '文件选择已失效，请重新选择文件。',
  SOURCE_CHANGED: '本地文件已发生变化，请取消任务并重新上传。',
  REVISION_CHANGED: '云端文件内容已变化，请重新下载。',
  UPLOAD_EXPIRED: '上传任务已过期，请取消任务并重新上传。',
  TRANSFER_NOT_FOUND: '此任务当前不可用，请刷新传输列表。',
  TRANSFER_BUSY: '任务正在停止，请稍后再试。',
  CANCEL_PENDING: '正在确认取消结果…',
  CANCEL_NOT_CONFIRMED: 'Moss 尚未确认取消结果，可稍后重试取消。',
  HOST_RESTARTED: '上次退出时已暂停，可继续传输。',
  REMOTE_CONNECTION_CHANGED: '服务器连接已变化，请确认连接后继续。',
  ACCOUNT_CHANGED: '账号已变化，请刷新后重试。',
  PERMISSION_DENIED: '没有操作权限，请检查应用和账号授权。',
  APP_PERMISSION_DENIED: '没有操作权限，请检查应用授权。',
  FORBIDDEN: '当前账号没有访问权限。',
  UNAUTHENTICATED: '请在 Moss 设置中登录服务器。',
  REMOTE_DISABLED: '请在 Moss 设置中开启远程连接。',
  APP_DISABLED: '网盘已停用，请在 Moss 的应用管理中启用。',
  APP_INSTANCE_DISABLED: '网盘已停用，请在 Moss 的应用管理中启用。',
  APP_BACKEND_UNAVAILABLE: '网盘服务暂不可用，请稍后重试。',
  APP_HOST_UNAVAILABLE: '云端服务暂不可用，请检查连接。',
  APP_HOST_TIMEOUT: '连接超时，请稍后重试。',
  APP_ACTION_TIMEOUT: '操作等待超时，请重试。',
  HOST_UNAVAILABLE: '应用连接不可用，请从 Moss 中重新打开网盘。',
  INTERRUPTED: '传输中断，可在连接恢复后继续。',
  NETWORK_ERROR: '连接失败，请检查网络后重试。',
}

export function errorCode(error: unknown): string {
  const value = error as { code?: unknown; message?: unknown } | null
  if (typeof value?.code === 'string') return value.code
  const message = String(value?.message ?? '')
  return Object.keys(messages).find(code => message.includes(code)) || 'REQUEST_FAILED'
}

export function errorMessage(error: unknown): string {
  const code = typeof error === 'string' ? error : errorCode(error)
  return messages[code] || '操作未完成，请检查连接后重试。'
}

export const isCancelled = (error: unknown) => ['CANCELLED', 'APP_ACTION_CANCELED'].includes(errorCode(error))
