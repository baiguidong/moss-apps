import { AudioLines, Captions, Clapperboard, GalleryHorizontalEnd, Image, ListChecks, MessagesSquare, PanelsTopLeft } from 'lucide-react'

export const workspaces = {
  工作台: { path: '/', title: '工作台', icon: PanelsTopLeft },
  任务: { path: '/tasks', title: '任务中心', icon: ListChecks },
  图片处理: { path: '/images', title: '图片处理', icon: Image },
  音视频处理: { path: '/media', title: '音视频处理', icon: AudioLines },
  转写字幕: { path: '/transcripts', title: '转写字幕', icon: Captions },
  分镜动画: { path: '/animation', title: '分镜动画', icon: GalleryHorizontalEnd },
  口播: { path: '/avatar', title: '数字人口播', icon: Clapperboard },
  对话: { path: '/chat', title: '角色对话', icon: MessagesSquare },
} as const
export type Tab = keyof typeof workspaces
export const mediaTabs = ['图片处理', '音视频处理', '转写字幕'] as const
export const creationTabs = ['分镜动画', '口播', '对话'] as const

export function currentRoute() {
  const hash = location.hash
  return hash.startsWith('#/workbench') ? new URLSearchParams(hash.split('?')[1]).get('target') || '#/' : hash
}
export function routeId() { return /^#\/projects\/([a-f0-9-]+)$/.exec(currentRoute())?.[1] || '' }
export function routeTab(): Tab {
  if (routeId()) return '口播'
  const path = '/' + (currentRoute().split('/')[1] || '')
  return (Object.keys(workspaces) as Tab[]).find(tab => workspaces[tab].path === path) || '工作台'
}
export function writePath(target: string) {
  history.replaceState(null, '', location.hash.startsWith('#/workbench') ? '#/workbench?target=' + encodeURIComponent(target) : target)
}
