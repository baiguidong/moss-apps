import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicJson, inside } from '@moss/local-tasks/backend'

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const projectId = /^project-[a-zA-Z0-9_-]+$/
const active = new Set(['queued', 'running', 'canceling'])

async function stat(file) {
  return fs.lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error })
}

async function sourcePath(root, relative) {
  const file = path.resolve(root, relative)
  inside(root, file)
  if (file === root || (await fs.realpath(file)) !== file) throw new Error('旧记录包含符号链接')
  return file
}

async function read(root, relative) {
  const file = await sourcePath(root, relative)
  if (!(await fs.lstat(file)).isFile()) throw new Error('旧记录格式不正确')
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

async function names(root, relative) {
  if (!await stat(path.join(root, relative))) return []
  return fs.readdir(await sourcePath(root, relative))
}

async function copyFile(source, destination, signal) {
  signal?.throwIfAborted()
  if (await stat(destination)) return false
  if (!(await fs.lstat(source)).isFile()) throw new Error('旧记录包含非常规文件')
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  const temporary = destination + '.import-' + randomUUID()
  try {
    await fs.copyFile(source, temporary, constants.COPYFILE_EXCL)
    signal?.throwIfAborted()
    try { await fs.link(temporary, destination) }
    catch (error) { if (error.code === 'EEXIST') return false; throw error }
    return true
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

async function copyTree(source, destination, signal) {
  signal?.throwIfAborted()
  await fs.mkdir(destination, { mode: 0o700, recursive: true })
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name)
    if (entry.isDirectory()) await copyTree(from, to, signal)
    else await copyFile(from, to, signal)
  }
}

async function importDirectory(source, destination, adapt, signal) {
  if (await stat(destination)) return false
  const parent = path.dirname(destination)
  await fs.mkdir(parent, { mode: 0o700, recursive: true })
  const temporary = await fs.mkdtemp(path.join(parent, '.import-'))
  try {
    await copyTree(source, temporary, signal)
    await adapt(temporary)
    signal?.throwIfAborted()
    await fs.rename(temporary, destination)
    return true
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

function interrupted(task) {
  const next = { ...task }
  delete next.pid
  delete next.processStart
  if (active.has(task.status)) Object.assign(next, { status: 'interrupted', message: '旧 App 中的任务未完成，可重新提交', finishedAt: Date.now() })
  return next
}

function workspacePath(file, field) {
  const relative = file[field]
  const parts = typeof relative === 'string' ? relative.split('/') : []
  const isInput = file.role === 'input',
    type = isInput ? 'files' : 'tasks',
    id = isInput ? file.id : file.taskId
  if (!uuid.test(id ?? '') || parts.length !== 3 || parts[0] !== type || parts[1] !== id || !parts[2] || ['.', '..'].includes(parts[2])) {
    throw new Error('旧文件记录的存储路径不正确')
  }
  return relative
}

export async function importWorkspace(source, service, signal) {
  const previous = await read(source, 'workspace.json')
  if (previous.version !== 1 || !Array.isArray(previous.files) || !Array.isArray(previous.tasks)) throw new Error('旧工作区的格式不兼容')
  const fileIds = new Set(service.state.files.map(file => file.id)), taskIds = new Set(service.state.tasks.map(task => task.id))
  const files = [], tasks = []
  for (const file of previous.files) {
    if (!uuid.test(file?.id ?? '') || !['input', 'output'].includes(file.role)) throw new Error('旧文件记录的 ID 不正确')
    if (fileIds.has(file.id)) continue
    const next = { ...file }
    delete next.url
    delete next.previewUrl
    for (const field of ['relative', 'previewRelative']) {
      if (field === 'previewRelative' && !file[field]) continue
      const relative = workspacePath(file, field)
      await copyFile(await sourcePath(source, relative), inside(service.root, path.resolve(service.root, relative)), signal)
    }
    files.push(next)
    fileIds.add(file.id)
  }
  for (const task of previous.tasks) {
    if (!uuid.test(task?.id ?? '') || !Array.isArray(task.outputs) || !task.input) throw new Error('旧任务记录格式不正确')
    if (taskIds.has(task.id)) continue
    tasks.push({ ...interrupted(task), outputs: task.outputs.filter(id => fileIds.has(id)) })
    taskIds.add(task.id)
  }
  signal?.throwIfAborted()
  service.state.files = service.state.files.concat(files)
  service.state.tasks = service.state.tasks.concat(tasks)
  try { await service.save() }
  catch (error) {
    const newFiles = new Set(files), newTasks = new Set(tasks)
    service.state.files = service.state.files.filter(file => !newFiles.has(file))
    service.state.tasks = service.state.tasks.filter(task => !newTasks.has(task))
    throw error
  }
  service.changed()
  return { files: files.length, tasks: tasks.length }
}

function movedPath(value, source, destination) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return value
  const relative = path.relative(source, value)
  return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('../') ? path.join(destination, relative) : value
}

export async function importJobs(source, destination, signal) {
  let count = 0, unavailable = 0
  for (const id of (await names(source, 'jobs')).filter(name => uuid.test(name))) {
    const relative = path.join('jobs', id), target = path.join(destination, relative)
    const imported = await importDirectory(await sourcePath(source, relative), target, async temporary => {
      const task = await read(temporary, 'task.json')
      if (task.id !== id || !Number.isSafeInteger(task.createdAt) || !task.input || !Array.isArray(task.artifacts)) throw new Error('旧媒体任务格式不正确')
      const next = interrupted(task)
      delete next.readRoots
      const inputPath = movedPath(next.input.path, source, destination)
      next.input = { ...next.input, ...(inputPath === undefined ? {} : { path: inputPath }) }
      next.artifacts = next.artifacts.map((artifact, index) => {
        const original = path.isAbsolute(artifact.path ?? '') ? artifact.path : path.join(source, relative, artifact.path || '')
        const updated = movedPath(original, path.join(source, relative), target)
        if (updated !== original) return { ...artifact, path: updated }
        unavailable++
        return { ...artifact, path: path.join(target, '.external-artifact-' + index) }
      })
      await atomicJson(path.join(temporary, 'task.json'), next)
    }, signal)
    if (imported) count++
  }
  return { count, unavailable }
}

export async function importAnimations(source, destination, signal) {
  let count = 0
  for (const id of (await names(source, 'animation/projects')).filter(name => projectId.test(name))) {
    const relative = path.join('animation', 'projects', id), target = path.join(destination, relative)
    const imported = await importDirectory(await sourcePath(source, relative), target, async temporary => {
      const project = await read(temporary, 'project.json')
      if (project.id !== id || !Array.isArray(project.assets)) throw new Error('旧分镜项目格式不正确')
      for (const asset of project.assets) {
        if (!/^assets\/[^/]+$/.test(asset.url) || ['.', '..'].includes(path.basename(asset.url))) throw new Error('旧分镜素材路径不正确')
        await sourcePath(temporary, asset.url)
        asset.path = path.join(target, asset.url)
      }
      await atomicJson(path.join(temporary, 'project.json'), project)
    }, signal)
    if (imported) count++
  }
  return count
}

export async function importStudio(source, destination, projects, signal, conversation) {
  if (!await stat(path.join(source, 'library.json'))) return 0
  const lib = await read(source, 'library.json')
  if (!Array.isArray(lib.audio) || !Array.isArray(lib.avatars)) throw new Error('旧角色素材库的格式不兼容')
  await projects.editLibrary(async current => {
    const hadCustomAvatars = current.avatars.some(item => item.id !== 'moss')
    for (const [field, suffix] of [['audio', '.audio'], ['avatars', '.glb']]) {
      const known = new Set(current[field].map(item => item.id))
      for (const item of lib[field]) {
        if (known.has(item.id)) continue
        if (!uuid.test(item.id)) throw new Error('旧角色素材 ID 不正确')
        const relative = path.join('assets', item.id + suffix)
        await copyFile(await sourcePath(source, relative), path.join(destination, relative), signal)
        current[field].push(item)
        known.add(item.id)
      }
    }
    for (const [id, audioId] of Object.entries(lib.transcripts ?? {})) {
      if (!uuid.test(id) || !uuid.test(audioId)) throw new Error('旧口播字幕 ID 不正确')
      if (current.transcripts?.[id]) continue
      const relative = path.join('assets', id + '.json')
      await copyFile(await sourcePath(source, relative), path.join(destination, relative), signal)
      ;(current.transcripts ??= {})[id] = audioId
    }
    if (!hadCustomAvatars && current.avatars.some(item => item.id === lib.defaultAvatar)) current.defaultAvatar = lib.defaultAvatar
  })
  let count = 0
  for (const name of await names(source, 'projects')) {
    const id = name.slice(0, -5)
    if (!name.endsWith('.json') || !uuid.test(id)) continue
    const relative = path.join('projects', name)
    const project = await read(source, relative)
    if (project.id !== id || !Number.isSafeInteger(project.version)) throw new Error('旧口播项目格式不正确')
    if (await copyFile(await sourcePath(source, relative), path.join(destination, relative), signal)) count++
  }
  if (conversation) for (const name of await names(source, 'chat')) {
    signal?.throwIfAborted()
    const id = name.slice(0, -5)
    if (!name.endsWith('.json') || (id !== 'moss' && !uuid.test(id))) continue
    const state = await read(source, path.join('chat', name))
    if (state.avatarId !== id || !Array.isArray(state.messages)) throw new Error('旧角色对话格式不正确')
    await conversation.importHistory(state)
  }
  return count
}

export async function importHistory(selection, destination, services, signal) {
  const source = await fs.realpath(selection)
  const target = await fs.realpath(destination)
  if (source === target || source.startsWith(target + path.sep) || target.startsWith(source + path.sep)) throw new Error('请选择旧 App 的独立实例目录')
  if (await stat(path.join(source, 'workspace.json'))) {
    const image = await services.images()
    const { files, tasks } = await image.runTracked(() => importWorkspace(source, image, signal))
    return { summary: `已导入 ${files} 个图片文件、${tasks} 条图片任务记录` }
  }
  if (!await stat(path.join(source, 'jobs')) && !await stat(path.join(source, 'studio')) && !await stat(path.join(source, 'animation'))) {
    throw new Error('目录中没有旧工坊或图片工具的工作区数据')
  }
  const recordings = path.join(source, 'recordings')
  if (await stat(path.join(recordings, 'workspace.json'))) {
    const service = await services.recordings()
    const selected = await sourcePath(source, 'recordings')
    await service.runTracked(() => importWorkspace(selected, service, signal))
  }
  const projects = await services.studio(source, signal)
  const animation = await importAnimations(source, target, signal)
  const jobs = await importJobs(source, target, signal)
  const message = `已导入 ${jobs.count} 条媒体任务、${projects} 个口播项目、${animation} 个分镜项目`
  return { summary: jobs.unavailable ? `${message}。有 ${jobs.unavailable} 个产物引用了旧目录外的文件` : message }
}
