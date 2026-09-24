import type { CloudFile, CloudTransfer } from '@moss/app-sdk/cloud-storage'
import type { CloudEvent, DriveApi, DriveMethod, Input, Output } from '../contracts'
import { DriveError } from './errors'
import { folderNameError } from './file-name'

export function createDemoApi(): DriveApi {
  const stamp = Date.now()
  const files: CloudFile[] = []
  const contents = new Map<string, Blob>()
  function add(id: string, name: string, kind: CloudFile['kind'], parentId: string | null, content = '') {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    files.push({ id, name, kind, parentId, size: kind === 'folder' ? 0 : blob.size, revision: 'demo-1', createdAt: stamp, updatedAt: stamp - files.length * 3_600_000 })
    contents.set(id, blob)
  }
  add('projects', '项目资料', 'folder', null)
  add('design', '设计资源', 'folder', null)
  add('archive', '归档', 'folder', null)
  add('intro', '项目说明.md', 'file', null, '# 项目说明\n\n这是 Moss 网盘的浏览器演示文件。\n')
  add('notes', '会议记录.txt', 'file', null, 'Moss 网盘第一版\n文件列表、上传、下载。\n')
  add('sheet', '文件清单.csv', 'file', null, '名称,状态\n项目说明,已完成\n会议记录,已完成\n')
  add('readme', '使用说明.md', 'file', 'projects', '# 使用说明\n\n浏览器演示中的文件只保存在当前页面。\n')
  add('spec', '需求文档.md', 'file', 'projects', '# 网盘需求\n\n简单、美观、易用。\n')
  add('drafts', '草稿', 'folder', 'projects')
  add('palette', '配色说明.txt', 'file', 'design', 'Moss：柔和背景、绿色主操作、清晰文字。\n')
  const tasks = new Map<string, CloudTransfer>()
  const picked = new Map<string, File>()
  const finishes = new Map<string, () => void>()
  const listeners = new Set<(event: CloudEvent) => void>()
  const pickers = new Map<HTMLInputElement, () => void>()
  const urls = new Set<string>()
  let disposed = false
  const emit = (task: CloudTransfer) => listeners.forEach(listener => listener({ name: 'transfers.changed', data: { ...task } }))
  const update = (task: CloudTransfer) => { task.updatedAt = Math.max(Date.now(), task.updatedAt + 1); emit(task); return { ...task } }
  function createTask(name: string, size: number, direction: CloudTransfer['direction'], fileId: string | null, finish: () => void) {
    const id = crypto.randomUUID(), now = Date.now()
    const task: CloudTransfer = { id, transferId: id, name, direction, fileId, state: 'running', totalBytes: size, transferredBytes: 0, error: null, createdAt: now, updatedAt: now }
    tasks.set(id, task); finishes.set(id, finish); emit(task)
    return { transferId: id }
  }
  const timer = setInterval(() => {
    for (const task of tasks.values()) {
      if (task.state !== 'running') continue
      task.transferredBytes = Math.min(task.totalBytes, task.transferredBytes + Math.max(1, Math.ceil(task.totalBytes / 20)))
      if (task.transferredBytes >= task.totalBytes) {
        task.state = 'completed'; finishes.get(task.id)?.(); finishes.delete(task.id)
      }
      update(task)
    }
  }, 300)
  async function request(method: DriveMethod, input: Record<string, any>): Promise<unknown> {
    if (disposed) throw new DriveError('APP_ACTION_CANCELED')
    if (method === 'status.get') return { state: 'ready', version: 1 }
    if (method === 'quota.get') return { usedBytes: files.reduce((sum, file) => sum + file.size, 0), reservedBytes: 0, limitBytes: 10 * 1024 ** 3 }
    if (method === 'files.list') {
      const all = files.filter(file => file.parentId === (input.parentId ?? null))
      const offset = Number(input.cursor || 0), limit = input.limit || 100
      return { files: all.slice(offset, offset + limit).map(file => ({ ...file })), nextCursor: all.length > offset + limit ? String(offset + limit) : null }
    }
    if (method === 'folders.create') {
      const parentId = input.parentId ?? null, name = String(input.name).normalize('NFC')
      if (folderNameError(name)) throw new DriveError('INVALID_NAME')
      if (parentId && !files.some(file => file.id === parentId && file.kind === 'folder')) throw new DriveError('FILE_NOT_FOUND')
      if (files.some(file => file.parentId === parentId && file.name === name)) throw new DriveError('NAME_CONFLICT')
      const folder: CloudFile = { id: crypto.randomUUID(), parentId, name, kind: 'folder', size: 0, revision: 'demo-1', createdAt: Date.now(), updatedAt: Date.now() }
      files.push(folder)
      return { ...folder }
    }
    if (method === 'files.delete') {
      const index = files.findIndex(file => file.id === input.fileId)
      if (index < 0) throw new DriveError('FILE_NOT_FOUND')
      if (files[index].kind !== 'file') throw new DriveError('FORBIDDEN')
      files.splice(index, 1); contents.delete(input.fileId)
      for (const task of tasks.values()) {
        if (task.fileId === input.fileId && !['completed', 'cancelled'].includes(task.state)) {
          task.state = 'paused'; task.error = 'FILE_NOT_FOUND'; finishes.delete(task.id); update(task)
        }
      }
      return { ok: true }
    }
    if (method === 'local-files.pick') return await new Promise(resolve => {
      const picker = document.createElement('input')
      picker.type = 'file'; picker.multiple = true; picker.hidden = true
      const finish = () => {
        const selected = [...(picker.files || [])].slice(0, 100).map(file => {
          const handle = crypto.randomUUID(); picked.set(handle, file)
          return { handle, name: file.name, size: file.size }
        })
        picker.remove(); pickers.delete(picker); resolve({ files: selected })
      }
      picker.addEventListener('change', finish, { once: true }); picker.addEventListener('cancel', finish, { once: true })
      pickers.set(picker, finish); document.body.append(picker); picker.click()
    })
    if (method === 'uploads.start') {
      const file = picked.get(input.handle)
      if (!file) throw new DriveError('INVALID_HANDLE')
      const parentId = input.parentId ?? null, name = input.name || file.name
      if (files.some(item => item.parentId === parentId && item.name === name) || [...tasks.values()].some(task => task.direction === 'upload' && task.name === name && !['completed', 'cancelled'].includes(task.state))) throw new DriveError('NAME_CONFLICT')
      picked.delete(input.handle)
      return createTask(name, file.size, 'upload', null, () => {
        const id = crypto.randomUUID(), now = Date.now()
        files.push({ id, parentId, name, kind: 'file', size: file.size, revision: 'demo-1', createdAt: now, updatedAt: now })
        contents.set(id, file)
      })
    }
    if (method === 'downloads.start') {
      const file = files.find(item => item.id === input.fileId && item.kind === 'file')
      if (!file) throw new DriveError('FILE_NOT_FOUND')
      return createTask(file.name, file.size, 'download', file.id, () => {
        const url = URL.createObjectURL(contents.get(file.id)!); urls.add(url)
        const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove()
      })
    }
    if (method === 'transfers.list') {
      const all = [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
      const offset = Number(input.cursor || 0), limit = input.limit || 200
      return { transfers: all.slice(offset, offset + limit).map(task => ({ ...task })), nextCursor: all.length > offset + limit ? String(offset + limit) : null }
    }
    const task = tasks.get(input.transferId)
    if (!task) throw new DriveError('TRANSFER_NOT_FOUND')
    if (method === 'transfers.get') return { ...task }
    if (['completed', 'cancelled'].includes(task.state)) return { ...task }
    if (method === 'transfers.pause') task.state = 'paused'
    if (method === 'transfers.resume') {
      if (task.direction === 'download' && !contents.has(task.fileId!)) throw new DriveError('FILE_NOT_FOUND')
      task.state = 'running'
    }
    if (method === 'transfers.cancel') { task.state = 'cancelled'; finishes.delete(task.id) }
    return update(task)
  }
  return {
    demo: true,
    request: <M extends DriveMethod>(method: M, input: Input<M>) => request(method, input) as Promise<Output<M>>,
    runtime: async () => ({ state: 'demo' }),
    onCloud: callback => { listeners.add(callback); return () => { listeners.delete(callback) } },
    onRuntime: () => () => {},
    dispose() {
      disposed = true; clearInterval(timer); listeners.clear()
      for (const finish of pickers.values()) finish()
      for (const url of urls) URL.revokeObjectURL(url)
      picked.clear(); contents.clear(); finishes.clear()
    },
  }
}
