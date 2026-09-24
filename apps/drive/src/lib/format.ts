import type { CloudTransfer } from '@moss/app-sdk/cloud-storage'
export function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
}
export const date = (stamp: number) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(stamp)
export const fullDate = (stamp: number) => new Date(stamp).toLocaleString('zh-CN', { hour12: false })
export const percent = (task: CloudTransfer) => task.state === 'completed' ? 100 : task.totalBytes > 0 ? Math.min(100, Math.floor(task.transferredBytes / task.totalBytes * 100)) : 0
export const taskLabel = (task: CloudTransfer) => task.error === 'CANCEL_PENDING' ? '正在取消' : ({ queued: '等待中', running: task.direction === 'upload' ? '上传中' : '下载中', paused: '已暂停', completed: '已完成', cancelled: '已取消' })[task.state]
