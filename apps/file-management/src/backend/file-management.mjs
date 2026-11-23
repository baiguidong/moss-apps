import backup from './engine.mjs'
import cleanup, { assertScan, fixOptions, isCleanup, isScan } from './cleanup.mjs'
import { selectedMatches } from './cleanup-result.mjs'
import { importLegacyHistory } from './history.mjs'
import { requireVideoProvider, usesVideo, videoAppId, videoProvider, videoWorkerEnv } from './video-runtime.mjs'

function engineFor(input) {
  return isCleanup(input) ? cleanup : backup
}

function cleanupCommand({ help, subcommands, ...command }) {
  return subcommands ? { ...command, subcommands: subcommands.map(cleanupCommand) } : command
}

export default {
  id: 'file-management',
  spec: backup.spec,
  externalImagePreviews: true,
  workerEnv(context, input, { backend, signal } = {}) {
    if (usesVideo(input) && input.followUp?.operation !== 'trash') return videoWorkerEnv(backend.host, signal).then(env => ({ RESTIC_PASSWORD: '', ...env }))
    return isCleanup(input) ? { RESTIC_PASSWORD: '' } : backup.workerEnv(context)
  },
  requireReady(context, input) {
    engineFor(input).requireReady?.(context)
  },
  async catalog(options) {
    const [backupCatalog, cleanupCatalog] = await Promise.all([backup.catalog(options), cleanup.catalog(options)])
    return { ...backupCatalog, cleanup: { ...cleanupCatalog, commands: cleanupCatalog.commands.map(cleanupCommand) } }
  },
  validate(input) {
    return engineFor(input).validate(input)
  },
  execute(input, context) {
    return engineFor(input).execute(input, context)
  },
  register(backend, context, tasks) {
    const videoStatus = async signal => {
      const provider = await videoProvider(backend.host, signal)
      return { available: Boolean(provider.ref), appId: videoAppId, message: provider.message }
    }
    async function startCleanup(input, action) {
      if (!isCleanup(input)) throw new Error('请选择扫描类别')
      if (usesVideo(input) && input.followUp?.operation !== 'trash') await requireVideoProvider(backend.host, action.signal)
      return tasks.startTask(input, action.source?.surface === 'tool' ? 'agent-tool' : 'ui', action.signal)
    }
    backend.registerAction('cleanup.video.status', (_input, action) => videoStatus(action.signal))
    backend.registerAction('workspace.summary', async () => ({
      artifactUrlsDeferred: true,
      tasks: (await tasks.listTasks()).map(({ id, input, source, status, createdAt, finishedAt, message }) => ({
        id, input: { command: input.command, repo: input.repo, paths: input.paths, snapshot: input.snapshot, target: input.target,
          followUp: input.followUp && { id: input.followUp.id, operation: input.followUp.operation } },
        source, status, createdAt, finishedAt, message, artifacts: [],
      })),
    }))
    backend.registerAction('cleanup.start', startCleanup)
    backend.registerAction('cleanup.apply', async ({ id, operation, paths }, action) => {
      const scan = await tasks.getTask(id)
      if (scan.status !== 'succeeded' || !isScan(scan.input)) throw new Error('请选择已完成的扫描结果')
      if (operation === 'trash') {
        selectedMatches(scan, paths)
        return startCleanup({ command: scan.input.command, confirmChanges: true, followUp: { id, operation, paths } }, action)
      }
      const { command, extraArgs, suboptions } = scan.input
      if (!Object.hasOwn(fixOptions, command) || extraArgs?.length || suboptions?.['custom-ffmpeg-command']) {
        throw new Error('此扫描结果需要使用原设置手动处理')
      }
      const fix = fixOptions[command]
      return startCleanup({ ...scan.input, paths: scan.readRoots?.length ? scan.readRoots : scan.input.paths,
        options: { ...scan.input.options, ...fix.options }, suboptions: { ...suboptions, ...fix.suboptions },
        confirmChanges: true, followUp: { id, operation } }, action)
    })
    backend.registerAction('cleanup.scan', (input, action) => {
      assertScan(input)
      return startCleanup(input, action)
    })
    backend.registerAction('cleanup.execute', (input, action) => {
      if (input.confirmChanges !== true) throw new Error('请确认本次文件清理的范围和策略')
      return startCleanup(input, action)
    })
    backend.registerAction('agent.catalog', async ({ cleanupCommand: command }, action) => {
      const [backupCatalog, cleanupCatalog] = await Promise.all([backup.catalog({}), cleanup.catalog({})])
      if (command) return { version: cleanupCatalog.version, command: cleanupCommand(cleanupCatalog.commands.find(item => item.id === command)),
        ...(usesVideo({ command }) ? { videoDependency: await videoStatus(action?.signal) } : {}) }
      const commands = cleanupCatalog.commands.map(({ id, title }) => ({ id, title }))
      return { ...backupCatalog, cleanup: { version: cleanupCatalog.version, commands, videoDependency: await videoStatus(action?.signal) } }
    })
    backend.registerAction('history.import', async (_input, action) => {
      const result = await importLegacyHistory(context.dataDir, action.signal)
      if (result.imported) backend.emit('workspace.changed', {})
      return result
    })
  },
}
