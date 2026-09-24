import type { CloudStorageInputMap, CloudStorageOutputMap, CloudTransfer, CloudStorageState } from '@moss/app-sdk/cloud-storage'

export const DRIVE_METHODS = [
  'status.get', 'quota.get', 'files.list', 'folders.create', 'files.delete', 'local-files.pick', 'uploads.start',
  'downloads.start', 'transfers.list', 'transfers.get', 'transfers.pause',
  'transfers.resume', 'transfers.cancel',
] as const
export type DriveMethod = typeof DRIVE_METHODS[number]
export type Input<M extends DriveMethod> = CloudStorageInputMap[M]
export type Output<M extends DriveMethod> = CloudStorageOutputMap[M]
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
export type CloudEvent =
  | { name: 'storage.status-changed'; data: { state: CloudStorageState } }
  | { name: 'transfers.progress' | 'transfers.changed'; data: CloudTransfer }
export interface RuntimeStatus { state: string; error?: string }
export interface DriveApi {
  readonly demo: boolean
  request<M extends DriveMethod>(method: M, input: Input<M>): Promise<Output<M>>
  runtime(): Promise<RuntimeStatus>
  onCloud(callback: (event: CloudEvent) => void): () => void
  onRuntime(callback: () => void): () => void
  dispose(): void
}
export const actionTimeout = (method: DriveMethod) =>
  method === 'local-files.pick' || method === 'downloads.start' ? 300_000 : 45_000
