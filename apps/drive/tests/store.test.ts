import { afterEach, expect, test } from 'bun:test'
import type { CloudFile, CloudTransfer } from '@moss/app-sdk/cloud-storage'
import type { CloudEvent, DriveApi } from '../src/contracts'
import { DriveError } from '../src/lib/errors'
import { DriveStore, mergeTransfer } from '../src/lib/store'

const file = (id: string, kind: CloudFile['kind'] = 'file'): CloudFile => ({ id, parentId: null, name: id, kind, size: 40, revision: '1', createdAt: 1, updatedAt: 1 })
const task = (patch: Partial<CloudTransfer> = {}): CloudTransfer => ({ id: 't', transferId: 't', direction: 'upload', name: 'report', fileId: null, state: 'running', totalBytes: 100, transferredBytes: 10, error: null, createdAt: 1, updatedAt: 2, ...patch })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 2)) }
  throw new Error('Condition did not settle')
}
const cleanup: Array<() => void> = []
afterEach(() => { cleanup.splice(0).forEach(stop => stop()) })
async function fixture(overrides: Record<string, (input: any) => any> = {}) {
  const listeners = new Set<(event: CloudEvent) => void>(), calls: Array<{ method: string; input: any }> = []
  const handlers: Record<string, (input: any) => any> = {
    'status.get': () => ({ state: 'ready' }), 'files.list': () => ({ files: [], nextCursor: null }),
    'quota.get': () => ({ usedBytes: 0, reservedBytes: 0, limitBytes: 1000 }),
    'transfers.list': () => ({ transfers: [], nextCursor: null }), 'transfers.get': () => task(), ...overrides,
  }
  const api: DriveApi = {
    demo: false, runtime: async () => ({ state: 'running' }),
    request: async (method, input) => { calls.push({ method, input }); return await handlers[method]!(input) },
    onCloud: cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, onRuntime: () => () => {}, dispose: () => {},
  }
  const store = new DriveStore(api); cleanup.push(() => store.dispose()); store.start()
  await until(() => store.getSnapshot().cloud === 'ready')
  return { store, handlers, calls, emit: (event: CloudEvent) => listeners.forEach(fn => fn(event)), settle: () => until(() => !store.getSnapshot().refreshing) }
}

test('navigation discards an older folder response; cursor pages deduplicate IDs', async () => {
  const f = await fixture(); await f.settle()
  const old = deferred<any>()
  f.handlers['files.list'] = input => input.parentId === 'old' ? old.promise : { files: [file(input.cursor ? 'second' : 'new'), ...(input.cursor ? [file('new')] : [])], nextCursor: input.cursor ? null : 'page-2' }
  const opening = f.store.enter(file('old', 'folder'))
  await f.store.navigate([{ id: null, name: '全部文件' }, { id: 'new', name: 'new' }])
  old.resolve({ files: [file('wrong')], nextCursor: null }); await opening
  expect(f.store.getSnapshot().files.map(v => v.id)).toEqual(['new'])
  await f.store.loadFiles(true)
  expect(f.store.getSnapshot().files.map(v => v.id)).toEqual(['new', 'second'])
})

test('events beat stale history snapshots; all transfer pages restore', async () => {
  const f = await fixture(); await f.settle()
  const page = deferred<any>()
  f.handlers['transfers.list'] = input => input.cursor ? { transfers: [task({ id: 'second', transferId: 'second' })], nextCursor: null } : page.promise
  const restoring = f.store.loadTasks()
  f.emit({ name: 'transfers.changed', data: task({ state: 'completed', transferredBytes: 100, updatedAt: 5 }) })
  page.resolve({ transfers: [task({ updatedAt: 5 })], nextCursor: 'next' }); await restoring
  expect(f.store.getSnapshot().tasks).toHaveLength(2)
  expect(f.store.getSnapshot().tasks.find(v => v.id === 't')!.state).toBe('completed')
})

test('upload uses directory captured before picker and reports individual failures without replay', async () => {
  const picker = deferred<any>(), f = await fixture({ 'local-files.pick': () => picker.promise }); await f.settle()
  f.handlers['uploads.start'] = input => { if (input.handle === 'bad') throw new DriveError('NAME_CONFLICT'); return { transferId: 't' } }
  await f.store.enter(file('target', 'folder'))
  const uploading = f.store.upload()
  await f.store.back(0)
  picker.resolve({ files: [{ handle: 'good', name: 'good.txt', size: 40 }, { handle: 'bad', name: 'bad.txt', size: 40 }] })
  await uploading
  expect(f.calls.filter(v => v.method === 'uploads.start').map(v => v.input)).toEqual([{ handle: 'good', parentId: 'target' }, { handle: 'bad', parentId: 'target' }])
  expect(f.store.getSnapshot().notice).toContain('1 个上传任务')
  expect(f.store.getSnapshot().operationErrors[0]).toMatchObject({ name: 'bad.txt', message: expect.stringContaining('同名') })
})

test('account invalidation clears all private state and discards pending picker and list results', async () => {
  const picker = deferred<any>(), listing = deferred<any>(), f = await fixture({ 'local-files.pick': () => picker.promise }); await f.settle()
  f.emit({ name: 'transfers.changed', data: task() })
  f.handlers['files.list'] = () => listing.promise
  const navigating = f.store.enter(file('secret', 'folder')), uploading = f.store.upload()
  f.emit({ name: 'storage.status-changed', data: { state: 'unauthenticated' } })
  f.handlers['status.get'] = () => ({ state: 'unauthenticated' })
  listing.resolve({ files: [file('private')], nextCursor: null })
  picker.resolve({ files: [{ handle: 'old-account', name: 'old', size: 40 }] })
  await Promise.all([navigating, uploading])
  expect(f.store.getSnapshot()).toMatchObject({ files: [], tasks: [], quota: null, picking: false, path: [{ id: null, name: '全部文件' }] })
  expect(f.calls.some(v => v.method === 'uploads.start')).toBe(false)
})

test('cancelled save dialog is silent and creates no task', async () => {
  const f = await fixture({ 'downloads.start': () => { throw new DriveError('CANCELLED') } }); await f.settle()
  await f.store.download(file('report'))
  expect(f.store.getSnapshot()).toMatchObject({ tasks: [], operationErrors: [], downloads: [], notice: null })
})

test('task creation remains successful if progress query fails; no duplicate upload', async () => {
  const f = await fixture({ 'local-files.pick': () => ({ files: [{ handle: 'one', name: 'report', size: 100 }] }), 'uploads.start': () => ({ transferId: 'new' }), 'transfers.get': () => { throw new DriveError('NETWORK_ERROR') } }); await f.settle()
  await f.store.upload()
  expect(f.store.getSnapshot().notice).toContain('1 个上传任务')
  expect(f.store.getSnapshot().tasksError).toContain('已创建')
  expect(f.store.getSnapshot().operationErrors).toEqual([])
  expect(f.calls.filter(v => v.method === 'uploads.start')).toHaveLength(1)
})

test('pending cancellation stays paused until final event; old response cannot regress completion', async () => {
  const f = await fixture(); await f.settle()
  f.emit({ name: 'transfers.changed', data: task() })
  f.handlers['transfers.cancel'] = () => task({ state: 'paused', error: 'CANCEL_PENDING', updatedAt: 3 })
  await f.store.control(task(), 'cancel')
  expect(f.store.getSnapshot().tasks[0]).toMatchObject({ state: 'paused', error: 'CANCEL_PENDING' })
  const response = deferred<any>()
  f.handlers['transfers.resume'] = () => response.promise
  const resume = f.store.control(f.store.getSnapshot().tasks[0]!, 'resume')
  f.emit({ name: 'transfers.changed', data: task({ state: 'completed', updatedAt: 4, transferredBytes: 100 }) })
  response.resolve(task({ state: 'running', updatedAt: 4 })); await resume
  expect(f.store.getSnapshot().tasks[0]!.state).toBe('completed')
})

test('late control responses cannot repopulate another account', async () => {
  const response = deferred<any>(), f = await fixture({ 'transfers.pause': () => response.promise }); await f.settle()
  f.emit({ name: 'transfers.changed', data: task() })
  const pause = f.store.control(task(), 'pause')
  f.emit({ name: 'storage.status-changed', data: { state: 'remote_disabled' } })
  response.resolve(task({ state: 'paused', updatedAt: 10 })); await pause
  expect(f.store.getSnapshot().tasks).toEqual([])
  expect(f.store.getSnapshot().controls).toEqual([])
})

test('disposal removes event listeners and suppresses pending responses', async () => {
  const listing = deferred<any>(), f = await fixture(); await f.settle()
  f.handlers['files.list'] = () => listing.promise
  const pending = f.store.loadFiles(), snapshot = f.store.getSnapshot()
  f.store.dispose()
  listing.resolve({ files: [file('late')], nextCursor: null }); await pending
  f.emit({ name: 'transfers.changed', data: task() })
  expect(f.store.getSnapshot()).toBe(snapshot)
})


test('same-timestamp history does not erase a cancellation event error', () => {
  const current = task({ state: 'paused', error: 'CANCEL_PENDING', updatedAt: 5 })
  expect(mergeTransfer(current, task({ state: 'paused', error: null, updatedAt: 5 }))).toBe(current)
})

test('new transfers select their tab; completion and refresh preserve the user’s view and path', async () => {
  const f = await fixture({
    'local-files.pick': () => ({ files: [{ handle: 'one', name: 'report', size: 100 }] }),
    'uploads.start': () => ({ transferId: 't' }),
    'downloads.start': () => ({ transferId: 'download' }),
    'transfers.get': input => task({ id: input.transferId, transferId: input.transferId, direction: input.transferId === 'download' ? 'download' : 'upload' }),
  }); await f.settle()
  await f.store.enter(file('folder', 'folder'))
  await f.store.upload()
  expect(f.store.getSnapshot().view).toBe('upload')
  f.store.setView('files')
  f.emit({ name: 'transfers.changed', data: task({ state: 'completed', transferredBytes: 100, updatedAt: 8 }) })
  expect(f.store.getSnapshot()).toMatchObject({ view: 'files', notice: null })
  await f.store.download(file('report'))
  expect(f.store.getSnapshot().view).toBe('download')
  await f.store.refresh()
  expect(f.store.getSnapshot()).toMatchObject({ view: 'download', path: [{ id: null, name: '全部文件' }, { id: 'folder', name: 'folder' }] })
  expect(f.store.getSnapshot().tasks).toHaveLength(2)
})

test('create captures its directory and blocks duplicate submissions without replacing a new directory', async () => {
  const creating = deferred<any>(), f = await fixture({ 'folders.create': () => creating.promise }); await f.settle()
  await f.store.enter(file('target', 'folder'))
  f.store.openCreateFolder(); f.store.setFolderName('  新目录  ')
  const request = f.store.submitDialog()
  await f.store.submitDialog(); f.store.closeDialog()
  expect(f.store.getSnapshot().dialog?.pending).toBe(true)
  f.handlers['files.list'] = () => ({ files: [file('root-only')], nextCursor: null })
  await f.store.back(0)
  creating.resolve({ ...file('new', 'folder'), parentId: 'target' }); await request
  expect(f.calls.filter(call => call.method === 'folders.create')).toEqual([{ method: 'folders.create', input: { parentId: 'target', name: '新目录' } }])
  expect(f.store.getSnapshot()).toMatchObject({ dialog: null, files: [file('root-only')] })
})

test('invalid and conflicting directory names keep the dialog editable', async () => {
  const f = await fixture({ 'folders.create': () => { throw new DriveError('NAME_CONFLICT') } }); await f.settle()
  f.store.openCreateFolder()
  for (const name of ['', '..', 'a/b', 'a\\b', 'a\u0000b', '文'.repeat(86)]) {
    f.store.setFolderName(name); await f.store.submitDialog()
    expect(f.store.getSnapshot().dialog?.error).toBeTruthy()
  }
  expect(f.calls.some(call => call.method === 'folders.create')).toBe(false)
  f.store.setFolderName('文档'); await f.store.submitDialog()
  expect(f.store.getSnapshot().dialog).toMatchObject({ name: '文档', pending: false, error: expect.stringContaining('同名') })
  f.store.setFolderName('其他文档')
  expect(f.store.getSnapshot().dialog?.error).toBeNull()
})

test('delete requires confirmation and retains the file when permission is denied', async () => {
  const f = await fixture({ 'files.list': () => ({ files: [file('report')], nextCursor: null }), 'files.delete': () => { throw new DriveError('PERMISSION_DENIED') } }); await f.settle()
  f.store.openDeleteFile(file('report')); f.store.closeDialog()
  expect(f.calls.some(call => call.method === 'files.delete')).toBe(false)
  f.store.openDeleteFile(file('report')); await f.store.submitDialog()
  expect(f.store.getSnapshot().dialog).toMatchObject({ pending: false, error: expect.stringContaining('权限') })
  expect(f.store.getSnapshot().files).toEqual([file('report')])
  f.store.closeDialog(); f.store.openDeleteFile(file('folder', 'folder'))
  expect(f.store.getSnapshot().dialog).toBeNull()
})

test('delete updates quota and a stale list response cannot resurrect the file', async () => {
  const old = deferred<any>()
  const f = await fixture({ 'files.list': () => ({ files: [file('report')], nextCursor: null }), 'files.delete': () => ({ ok: true }) }); await f.settle()
  f.handlers['files.list'] = () => old.promise
  const listing = f.store.loadFiles()
  f.handlers['files.list'] = () => ({ files: [], nextCursor: null })
  f.handlers['quota.get'] = () => ({ usedBytes: 0, reservedBytes: 0, limitBytes: 1000 })
  f.store.openDeleteFile(file('report')); await f.store.submitDialog()
  old.resolve({ files: [file('report')], nextCursor: null }); await listing
  expect(f.store.getSnapshot()).toMatchObject({ files: [], dialog: null, quota: { usedBytes: 0 } })
  expect(f.calls.filter(call => call.method === 'files.delete')).toEqual([{ method: 'files.delete', input: { fileId: 'report' } }])
  expect(f.calls.filter(call => call.method === 'quota.get')).toHaveLength(2)
})

test('account changes dismiss file dialogs and discard late mutation results', async () => {
  const creating = deferred<any>(), f = await fixture({ 'folders.create': () => creating.promise }); await f.settle()
  f.store.openCreateFolder(); f.store.setFolderName('private')
  const pending = f.store.submitDialog()
  f.handlers['status.get'] = () => ({ state: 'remote_disabled' })
  f.emit({ name: 'storage.status-changed', data: { state: 'remote_disabled' } })
  creating.resolve(file('private', 'folder')); await pending
  expect(f.store.getSnapshot()).toMatchObject({ files: [], dialog: null, cloud: 'remote_disabled' })
})

test('a successful creation closes the dialog even if reloading the list fails', async () => {
  const f = await fixture({ 'folders.create': () => file('created', 'folder') }); await f.settle()
  f.handlers['files.list'] = () => { throw new DriveError('NETWORK_ERROR') }
  f.store.openCreateFolder(); f.store.setFolderName('created'); await f.store.submitDialog()
  expect(f.store.getSnapshot()).toMatchObject({ dialog: null, listError: expect.stringContaining('连接失败') })
  await f.store.submitDialog()
  expect(f.calls.filter(call => call.method === 'folders.create')).toHaveLength(1)
})
