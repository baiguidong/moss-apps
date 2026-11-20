import path from 'node:path'
import { LocalTasks } from '@moss/local-tasks/backend'
import { inspect } from '@moss/media-engines/transcript'

// Keep the existing file-picker and transcript editor contract over the workshop queue.
export function registerRecordings(backend, context, store, tasks, start, save) {
  let preparing
  const files = () => preparing ??= new LocalTasks({
    dataDir: path.join(context.dataDir, 'recordings'), inspect,
    artifactUrl: relative => backend.host.request('moss.artifacts/v1', 'url.get', { relativePath: 'recordings/' + relative }).then(r => r.url),
    onChanged: () => backend.emit('workspace.changed', {}),
  }).initialize().catch(error => { preparing = undefined; throw error })
  const add = (name, fn) => backend.registerAction('recording.' + name, fn)
  const output = async id => {
    const match = /^([\da-f-]{36}):(\d+)$/.exec(id)
    if (!match) throw new Error('请选择转写任务的产物')
    const task = await tasks.getTask(match[1]), index = Number(match[2])
    if (task.input.mode !== 'transcribe' || !task.artifacts[index]) throw new Error('转写产物不存在')
    return { id: task.id, index, artifact: task.artifacts[index] }
  }
  add('files.pick', async (_, ctx) => {
    const { paths } = await backend.host.request('moss.local-files/v1', 'pick', { kind: 'file', multiple: true }, { signal: ctx.signal })
    return paths.length ? (await files()).importFiles(paths, ctx.signal) : { files: [], errors: [] }
  })
  add('workspace.get', async () => {
    const catalog = await files()
    const inputs = catalog.state.files.map(({ relative, ...item }) => ({ ...item, url: '' }))
    const outputs = []
    const history = []
    for (const task of (await store.list()).filter(t => t.input.mode === 'transcribe')) {
      const ids = task.artifacts.map((artifact, index) => {
        const id = task.id + ':' + index
        outputs.push({ ...artifact, id, role: 'output', taskId: task.id, createdAt: task.createdAt, metadata: artifact.metadata || {}, url: '' })
        return id
      })
      history.push({ ...task, title: '转写 ' + path.basename(task.input.path), outputs: ids,
        progress: task.status === 'succeeded' ? 100 : Number(/(\d+)%/.exec(task.message)?.[1] || 0) })
    }
    return { files: [...inputs, ...outputs], tasks: history }
  })
  add('tasks.start', async (input, ctx) => {
    if (input.fileIds) {
      const catalog = await files(), file = catalog.file(input.fileIds[0])
      return start({ mode: 'transcribe', path: await catalog.filePath(file), sourceId: file.id, language: input.options?.language }, ctx)
    }
    // Retry uses the task's original saved input, including jobs created from the agent.
    return start({ mode: 'transcribe', path: input.path, language: input.language, sourceId: input.sourceId }, ctx)
  })
  add('tasks.cancel', ({ id }) => tasks.cancelTask(id))
  add('files.preview', async ({ id }) => {
    const item = await output(id)
    const artifact = (await tasks.details(item.id)).artifacts[item.index]
    if (!artifact.url) throw new Error(artifact.urlError || '转写产物不可用')
    return { url: artifact.url }
  })
  add('transcript.save', async (input, ctx) => {
    const item = await output(input.id)
    if (item.artifact.kind !== 'transcript') throw new Error('请选择逐字稿')
    return save({ ...input, id: item.id }, ctx)
  })
  add('files.export', async ({ ids }, ctx) => {
    const items = await Promise.all(ids.map(output))
    return tasks.exportArtifacts(items, ctx)
  })
  return async () => { if (preparing) await (await preparing).close() }
}
