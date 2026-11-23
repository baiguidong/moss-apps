import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { wav } from './speech.mjs'

const [assets, model, request, output] = process.argv.slice(2)
const { segments, rate } = JSON.parse(await fs.readFile(request, 'utf8'))
const { default: sherpa } = await import('sherpa-onnx-node')
const file = name => path.join(assets, name)
const tts = new sherpa.OfflineTts({
  model: {
    vits: { model, lexicon: file('lexicon.txt'), tokens: file('tokens.txt') },
    numThreads: Math.min(4, os.availableParallelism()), provider: 'cpu',
  },
  ruleFsts: ['date.fst', 'number.fst', 'phone.fst'].map(file).join(','),
})
const cues = [], parts = []
let duration = 0
for (const text of segments) {
  const { samples, sampleRate } = tts.generate({ text, sid: 0, speed: rate / 200 })
  if (!samples.length) continue
  const start = duration
  duration += samples.length / sampleRate
  if (duration > 600) throw new Error('每段口播最长 10 分钟，请拆分项目')
  const pcm = Buffer.allocUnsafe(samples.length * 2)
  for (let index = 0; index < samples.length; index++) {
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), index * 2)
  }
  parts.push(pcm)
  cues.push({ start, end: duration, text })
}
if (!duration) throw new Error('没有生成可播放的音轨')
await fs.writeFile(output, wav(parts, tts.sampleRate), { mode: 0o600 })
console.log(JSON.stringify({ duration, cues }))
