export interface Settings {
  name: string
  script: string
  avatarId: string
  source: 'script' | 'audio'
  audioId: string
  transcriptId: string
  voice: string
  rate: number
  aspect: '16:9' | '9:16'
  camera: 'upper' | 'head' | 'full'
  background: string
  subtitles: boolean
  quality: '720p' | '480p'
}
export interface Project extends Settings {
  resourceUri?: string
  presentation?: { title: string; route: string }
  estimatedSeconds?: number
  id: string
  version: number
  updatedAt: number
}
export interface Asset {
  id: string
  name: string
}
export interface Library {
  projects: Array<Asset & { version: number }>
  avatars: Asset[]
  audio: Asset[]
  defaultAvatar: string
  defaultVoice: string
  voices: { name: string; locale: string }[]
}
export type Call = (name: string, input?: any, signal?: AbortSignal) => Promise<any>
export interface Recording {
  id: string
  lease: string
  url: string
  project: Project
}
export function fieldsOf({
  id,
  version,
  updatedAt,
  presentation,
  resourceUri,
  estimatedSeconds,
  ...fields
}: Project): Settings {
  return fields
}
