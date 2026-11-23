import path from 'node:path'
import fs from 'node:fs/promises'
import { existingPaths } from '@moss/engine-apps/runtime'
import animation from '@moss/media-engines/animation'
import { execute as transcribe, inspect, validate as validateRecording } from '@moss/media-engines/transcript'
import media from './engine.mjs'
import linuxModel from '../../resources/whisper-linux.json' with { type: 'json' }

async function recording(input) {
  const [filePath] = await existingPaths([input.path])
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size === 0 || stat.size > 2 * 1024 ** 3) throw new Error('录音应为不超过 2 GiB 的文件')
  const file = { ...await inspect(filePath), id: input.sourceId || 'source', path: filePath, name: path.basename(filePath) }
  const request = validateRecording({ fileIds: [file.id], options: { language: input.language } }, [file])
  return { files: [file], input: request }
}

const renderOptions = input => ({ projectId: input.projectId, fps: input.fps, quality: input.quality })
export const snapshotRoot = (dataDir, version) => {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('动画版本无效')
  return path.join(dataDir, 'animation', 'snapshots', String(version))
}
export default {
  ...media,
  workerConcurrency: 1,
  async validate(input) {
    if (input.mode === 'transcribe') return recording(input)
    if (input.mode === 'animation') {
      snapshotRoot('.', input.version)
      return animation.validate(renderOptions(input))
    }
    return media.validate(input)
  },
  async execute(input, ctx) {
    if (input.mode === 'animation') {
      return animation.execute(renderOptions(input), { ...ctx, projectRoot: snapshotRoot(ctx.dataDir, input.version) })
    }
    if (input.mode !== 'transcribe') return media.execute(input, ctx)
    const source = await recording(input)
    let writes = Promise.resolve(), previous = ''
    const progress = (_percent, message) => {
      if (message !== previous) writes = writes.then(() => ctx.progress(message))
      previous = message
      return writes
    }
    try {
      const result = await transcribe({ ...source, dataDir: ctx.dataDir, outputDir: ctx.directory, signal: ctx.signal, progress,
        modelSpec: process.platform === 'linux' ? linuxModel : undefined })
      return { message: result.message, artifacts: result.files.map(file => ({ ...file, name: path.basename(file.path) })) }
    } finally { await writes }
  },
}
