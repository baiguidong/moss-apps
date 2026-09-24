import type { CloudFile, CloudTransfer, CloudStorageState } from '@moss/app-sdk/cloud-storage'
import type { CloudEvent, DriveApi, Output, RuntimeStatus } from '../contracts'
import { errorCode, errorMessage, isCancelled } from './errors'
import { folderNameError } from './file-name'

export interface Crumb { id: string | null; name: string }
export interface OperationError { id: string; name: string; message: string }
export type DriveView = 'files' | 'upload' | 'download'
export type FileDialogState = ({ kind: 'create-folder'; parent: Crumb; name: string } | { kind: 'delete-file'; file: CloudFile }) & { pending: boolean; error: string | null }
export interface DriveState {
  path: Crumb[]; files: CloudFile[]; cursor: string | null; listLoading: boolean; listError: string | null
  tasks: CloudTransfer[]; tasksLoading: boolean; tasksError: string | null
  quota: Output<'quota.get'> | null; quotaError: boolean
  cloud: CloudStorageState | 'loading'; runtime: RuntimeStatus; refreshing: boolean
  view: DriveView; dialog: FileDialogState | null; picking: boolean; downloads: string[]; controls: string[]
  notice: string | null; operationErrors: OperationError[]
}
const root = (): Crumb[] => [{ id: null, name: '全部文件' }]
const terminal = (task: CloudTransfer) => task.state === 'completed' || task.state === 'cancelled'
export function mergeTransfer(current: CloudTransfer | undefined, incoming: CloudTransfer, event = false): CloudTransfer {
  if (!current) return incoming
  if (incoming.updatedAt < current.updatedAt) return current
  if (incoming.updatedAt === current.updatedAt) {
    if (terminal(current) && !terminal(incoming)) return current
    if (!event && !(terminal(incoming) && !terminal(current))) return current
    if (current.state === incoming.state && current.transferredBytes > incoming.transferredBytes) return current
  }
  return incoming
}
const initial = (): DriveState => ({
  path: root(), files: [], cursor: null, listLoading: false, listError: null,
  tasks: [], tasksLoading: false, tasksError: null, quota: null, quotaError: false,
  cloud: 'loading', runtime: { state: 'starting' }, refreshing: false,
  view: 'files', dialog: null, picking: false, downloads: [], controls: [], notice: null, operationErrors: [],
})

export class DriveStore {
  private state = initial()
  private listeners = new Set<() => void>()
  private eventVersions = new Map<string, number>()
  private unsubscribers: Array<() => void> = []
  private alive = true
  private started = false
  private epoch = 0
  private listSequence = 0
  private refreshSequence = 0
  private taskSequence = 0
  private quotaSequence = 0
  private refreshTimer?: ReturnType<typeof setTimeout>
  private noticeTimer?: ReturnType<typeof setTimeout>
  private noticeTransfers = new Set<string>()
  private completionTimer?: ReturnType<typeof setTimeout>
  constructor(readonly api: DriveApi) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private patch(values: Partial<DriveState>) {
    if (!this.alive) return
    this.state = { ...this.state, ...values }
    if (this.state.notice && this.noticeTransfers.size && [...this.noticeTransfers].every(id => {
      const task = this.state.tasks.find(task => task.transferId === id)
      return task && terminal(task)
    })) {
      this.state = { ...this.state, notice: null }
      clearTimeout(this.noticeTimer); this.noticeTransfers.clear()
    }
    this.listeners.forEach(listener => listener())
  }
  private valid(epoch: number) { return this.alive && epoch === this.epoch }
  private clear(cloud: DriveState['cloud']) {
    clearTimeout(this.noticeTimer); this.noticeTransfers.clear()
    this.eventVersions.clear()
    this.epoch++; this.listSequence++; this.taskSequence++; this.quotaSequence++; this.refreshSequence++
    clearTimeout(this.completionTimer); this.completionTimer = undefined
    this.patch({ ...initial(), cloud, runtime: this.state.runtime, view: this.state.view })
  }
  private scheduleRefresh() {
    clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => { void this.refresh() }, 120)
  }
  start() {
    if (this.started || !this.alive) return
    this.started = true
    this.unsubscribers.push(this.api.onCloud(this.onCloud), this.api.onRuntime(() => this.scheduleRefresh()))
    void this.refresh()
  }
  dispose() {
    this.alive = false; this.epoch++
    this.unsubscribers.forEach(stop => stop()); this.listeners.clear()
    clearTimeout(this.refreshTimer); clearTimeout(this.completionTimer)
    clearTimeout(this.noticeTimer)
    this.api.dispose()
  }
  private onCloud = (event: CloudEvent) => {
    if (event.name === 'storage.status-changed') {
      const state = event.data.state
      if (state !== 'ready') { this.clear(state); this.scheduleRefresh() }
      else if (this.state.cloud !== 'ready') this.scheduleRefresh()
      return
    }
    if (this.state.cloud !== 'ready') return
    this.eventVersions.set(event.data.id, (this.eventVersions.get(event.data.id) || 0) + 1)
    const previous = this.state.tasks.find(task => task.id === event.data.id)
    this.acceptTasks([event.data], true)
    if (event.data.state === 'completed' && previous?.state !== 'completed') this.scheduleCompletionRefresh()
  }
  private scheduleCompletionRefresh() {
    // Coalesce a batch of small uploads, without postponing refresh indefinitely.
    if (this.completionTimer) return
    this.completionTimer = setTimeout(() => {
      this.completionTimer = undefined
      if (this.state.cloud === 'ready') { void this.loadFiles(); void this.loadQuota() }
    }, 450)
  }
  private acceptTasks(incoming: CloudTransfer[], event = false) {
    const tasks = new Map(this.state.tasks.map(task => [task.id, task]))
    for (const task of incoming) tasks.set(task.id, mergeTransfer(tasks.get(task.id), task, event))
    this.patch({ tasks: [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)) })
  }
  async refresh() {
    if (!this.alive) return
    const seq = ++this.refreshSequence, epoch = this.epoch
    const valid = () => this.valid(epoch) && seq === this.refreshSequence
    this.patch({ refreshing: true })
    try {
      const runtime = await this.api.runtime()
      if (!valid()) return
      this.patch({ runtime })
      if (runtime.state === 'disabled') { this.clear('unavailable'); return }
      const status = await this.api.request('status.get', {})
      if (!valid()) return
      if (status.state !== 'ready') { this.clear(status.state); return }
      this.patch({ cloud: 'ready' })
      await Promise.all([this.loadFiles(), this.loadQuota(), this.loadTasks()])
      if (!valid()) return
      // Starting an action may have started the backend; read its actual status again.
      const current = await this.api.runtime()
      if (valid()) this.patch({ runtime: current })
    } catch (error) {
      if (valid()) {
        this.clear('unavailable')
        this.patch({ runtime: { ...this.state.runtime, error: errorMessage(error) } })
      }
    } finally { if (valid()) this.patch({ refreshing: false }) }
  }
  async navigate(path: Crumb[]) {
    if (this.state.cloud !== 'ready') return
    this.patch({ path, files: [], cursor: null, listError: null })
    await this.loadFiles()
  }
  enter = (folder: CloudFile) => folder.kind === 'folder' ? this.navigate([...this.state.path, { id: folder.id, name: folder.name }]) : Promise.resolve()
  back = (index: number) => this.navigate(this.state.path.slice(0, index + 1))
  async loadFiles(more = false) {
    if (this.state.cloud !== 'ready' || (more && (!this.state.cursor || this.state.listLoading))) return
    const seq = ++this.listSequence, epoch = this.epoch
    const parentId = this.state.path.at(-1)!.id, cursor = more ? this.state.cursor : null
    const valid = () => this.valid(epoch) && seq === this.listSequence
    this.patch({ listLoading: true, listError: null })
    try {
      const page = await this.api.request('files.list', { parentId, limit: 100, ...(cursor ? { cursor } : {}) })
      if (!valid()) return
      const files = new Map((more ? this.state.files : []).map(file => [file.id, file]))
      page.files.forEach(file => files.set(file.id, file))
      this.patch({ files: [...files.values()], cursor: page.nextCursor })
    } catch (error) { if (valid()) this.handleReadError(error, { listError: errorMessage(error) }) }
    finally { if (valid()) this.patch({ listLoading: false }) }
  }
  private handleReadError(error: unknown, patch: Partial<DriveState>) {
    if (['ACCOUNT_CHANGED', 'REMOTE_CONNECTION_CHANGED', 'UNAUTHENTICATED', 'REMOTE_DISABLED'].includes(errorCode(error))) {
      this.clear(errorCode(error) === 'REMOTE_DISABLED' ? 'remote_disabled' : 'unauthenticated')
      this.scheduleRefresh()
    } else this.patch(patch)
  }
  async loadQuota() {
    const epoch = this.epoch, seq = ++this.quotaSequence
    try {
      const quota = await this.api.request('quota.get', {})
      if (this.valid(epoch) && seq === this.quotaSequence) this.patch({ quota, quotaError: false })
    } catch { if (this.valid(epoch) && seq === this.quotaSequence) this.patch({ quota: null, quotaError: true }) }
  }
  async loadTasks() {
    const epoch = this.epoch, seq = ++this.taskSequence
    const valid = () => this.valid(epoch) && seq === this.taskSequence
    this.patch({ tasksLoading: true, tasksError: null })
    let cursor: string | null = null
    const seen = new Set<string>()
    try {
      do {
        const page: Output<'transfers.list'> = await this.api.request('transfers.list', { limit: 200, ...(cursor ? { cursor } : {}) })
        if (!valid()) return
        this.acceptTasks(page.transfers)
        cursor = page.nextCursor
        if (cursor && seen.has(cursor)) throw new Error('Repeated transfer cursor')
        if (cursor) seen.add(cursor)
      } while (cursor)
    } catch (error) { if (valid()) this.handleReadError(error, { tasksError: errorMessage(error) }) }
    finally { if (valid()) this.patch({ tasksLoading: false }) }
  }
  setView = (view: DriveView) => this.patch({ view })
  openCreateFolder = () => {
    if (this.state.cloud !== 'ready' || this.state.dialog) return
    this.patch({ dialog: { kind: 'create-folder', parent: this.state.path.at(-1)!, name: '', pending: false, error: null } })
  }
  openDeleteFile = (file: CloudFile) => {
    if (this.state.cloud !== 'ready' || this.state.dialog || file.kind !== 'file' || !this.state.files.some(item => item.id === file.id)) return
    this.patch({ dialog: { kind: 'delete-file', file, pending: false, error: null } })
  }
  closeDialog = () => { if (!this.state.dialog?.pending) this.patch({ dialog: null }) }
  setFolderName = (name: string) => {
    const dialog = this.state.dialog
    if (dialog?.kind === 'create-folder' && !dialog.pending) this.patch({ dialog: { ...dialog, name, error: null } })
  }
  async submitDialog() {
    const dialog = this.state.dialog, epoch = this.epoch
    if (!dialog || dialog.pending || this.state.cloud !== 'ready') return
    const name = dialog.kind === 'create-folder' ? dialog.name.trim().normalize('NFC') : ''
    const invalid = dialog.kind === 'create-folder' ? folderNameError(name) : null
    if (invalid) { this.patch({ dialog: { ...dialog, error: invalid } }); return }
    const pending = { ...dialog, pending: true, error: null }
    this.patch({ dialog: pending })
    try {
      if (dialog.kind === 'create-folder') await this.api.request('folders.create', { parentId: dialog.parent.id, name })
      else await this.api.request('files.delete', { fileId: dialog.file.id })
      if (!this.valid(epoch)) return
      if (this.state.dialog === pending) this.patch({ dialog: null })
      const parentId = dialog.kind === 'create-folder' ? dialog.parent.id : dialog.file.parentId
      const sameDirectory = this.state.path.at(-1)!.id === parentId
      if (sameDirectory && dialog.kind === 'delete-file') this.patch({ files: this.state.files.filter(file => file.id !== dialog.file.id) })
      // A successful mutation is never retried because the subsequent refresh failed.
      await Promise.all([sameDirectory ? this.loadFiles() : undefined, dialog.kind === 'delete-file' ? this.loadQuota() : undefined])
    } catch (error) {
      if (!this.valid(epoch)) return
      if (this.state.dialog === pending) this.patch({ dialog: { ...dialog, error: dialog.kind === 'create-folder' && errorCode(error) === 'NAME_CONFLICT' ? '此目录已有同名文件或目录，请换一个名称。' : errorMessage(error) } })
      this.handleReadError(error, {})
    }
  }
  private showNotice(message: string, transfers: string[]) {
    clearTimeout(this.noticeTimer)
    this.noticeTransfers = new Set(transfers)
    this.patch({ notice: message })
    if (this.state.notice) this.noticeTimer = setTimeout(this.dismissNotice, 3500)
  }
  dismissNotice = () => {
    clearTimeout(this.noticeTimer); this.noticeTransfers.clear()
    this.patch({ notice: null })
  }
  dismissError = (id: string) => this.patch({ operationErrors: this.state.operationErrors.filter(error => error.id !== id) })
  private operationError(name: string, error: unknown) {
    if (isCancelled(error)) return
    this.patch({ operationErrors: [...this.state.operationErrors, { id: crypto.randomUUID(), name, message: errorMessage(error) }] })
    this.handleReadError(error, {})
  }
  private async rememberTask(id: string, epoch: number) {
    try {
      const task = await this.api.request('transfers.get', { transferId: id })
      if (!this.valid(epoch)) return
      this.acceptTasks([task])
      if (task.state === 'completed') this.scheduleCompletionRefresh()
    } catch {
      if (this.valid(epoch)) this.patch({ tasksError: '任务已创建，进度暂未同步。请刷新传输列表。' })
    }
  }
  async upload() {
    if (this.state.picking || this.state.cloud !== 'ready') return
    const epoch = this.epoch, parent = this.state.path.at(-1)!
    this.patch({ picking: true, notice: null })
    try {
      const picked = await this.api.request('local-files.pick', {})
      if (!this.valid(epoch) || !picked.files.length) return
      this.setView('upload')
      const started: string[] = []
      for (const file of picked.files) {
        if (!this.valid(epoch)) return
        try {
          const result = await this.api.request('uploads.start', { handle: file.handle, parentId: parent.id })
          if (!this.valid(epoch)) return
          started.push(result.transferId)
          await this.rememberTask(result.transferId, epoch)
        } catch (error) { if (this.valid(epoch)) this.operationError(file.name, error) }
      }
      if (this.valid(epoch) && started.length) this.showNotice(`已加入 ${started.length} 个上传任务 · ${parent.name}`, started)
    } catch (error) { if (this.valid(epoch)) this.operationError('选择文件', error) }
    finally { if (this.valid(epoch)) this.patch({ picking: false }) }
  }
  async download(file: CloudFile) {
    if (file.kind !== 'file' || this.state.cloud !== 'ready' || this.state.downloads.includes(file.id)) return
    const epoch = this.epoch
    this.patch({ downloads: [...this.state.downloads, file.id], notice: null })
    try {
      const result = await this.api.request('downloads.start', { fileId: file.id })
      if (!this.valid(epoch)) return
      this.setView('download')
      this.showNotice(`已加入下载任务：${file.name}`, [result.transferId])
      await this.rememberTask(result.transferId, epoch)
    } catch (error) { if (this.valid(epoch)) this.operationError(file.name, error) }
    finally { if (this.valid(epoch)) this.patch({ downloads: this.state.downloads.filter(id => id !== file.id) }) }
  }
  async control(task: CloudTransfer, action: 'pause' | 'resume' | 'cancel') {
    if (this.state.controls.includes(task.id) || this.state.cloud !== 'ready') return
    const epoch = this.epoch, eventVersion = this.eventVersions.get(task.id)
    this.patch({ controls: [...this.state.controls, task.id] })
    try {
      const result = await this.api.request(`transfers.${action}`, { transferId: task.transferId })
      if (this.valid(epoch)) this.acceptTasks([result], eventVersion === this.eventVersions.get(task.id))
    } catch (error) { if (this.valid(epoch)) this.operationError(task.name, error) }
    finally { if (this.valid(epoch)) this.patch({ controls: this.state.controls.filter(id => id !== task.id) }) }
  }
}
