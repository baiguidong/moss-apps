import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { restoreBundledAsset } from '@moss/engine-apps/bundled'
import { run } from '@moss/engine-apps/runtime'
import melo from '../../resources/melo.json' with { type: 'json' }

export const linuxVoice = 'Melo 中文'
export const defaultVoice = process.platform === 'linux' ? linuxVoice : 'Tingting'
export const voiceRevision = melo.id + '-' + melo.version
const worker = fileURLToPath(new URL('./voice-worker.mjs', import.meta.url))
const assets = fileURLToPath(new URL('../voices/melo-zh/', import.meta.url))

export async function synthesizeLinux(segments, rate, directory, dataDir, signal) {
  const model = await restoreBundledAsset(path.join(assets, 'model.onnx'), path.join(dataDir, 'models', voiceRevision, 'model.onnx'),
    melo.modelSha256, signal)
  const request = path.join(directory, 'voice.json')
  await fs.writeFile(request, JSON.stringify({ segments, rate }), { mode: 0o600 })
  try {
    const { stdout } = await run(process.execPath, [worker, assets, model, request, path.join(directory, 'audio.wav')], { signal })
    return JSON.parse(stdout)
  } finally {
    await fs.rm(request, { force: true })
  }
}
