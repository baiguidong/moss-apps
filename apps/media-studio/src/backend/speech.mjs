import path from 'node:path'
import fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { run, ensureBinary } from '@moss/engine-apps/runtime'
import spec from '../../resources/engine.json' with { type: 'json' }
import { linuxVoice, synthesizeLinux, voiceRevision } from './linux-voice.mjs'

let voiceList
export async function voices() {
  if (process.platform === 'linux') return [{ name: linuxVoice, locale: 'zh_CN' }]
  if (process.platform !== 'darwin') return []
  if (!voiceList) {
    const { stdout } = await run('/usr/bin/say', ['-v', '?'])
    voiceList = stdout
      .split('\n')
      .map((line) => /^(.+?)\s+([a-z]{2,3}_[A-Za-z_]+)\s+#/.exec(line))
      .filter(Boolean)
      .map((m) => ({ name: m[1].trim(), locale: m[2] }))
  }
  return voiceList
}
export const ffmpeg = (dataDir, signal) => ensureBinary(spec, dataDir, signal)
export function splitSpeech(text) {
  // Keep captions short enough for portrait video. Each cue has its own measured audio duration.
  return (text.match(/[^。！？!?；;，,、\n]+[。！？!?；;，,、]?/gu) || [])
    .flatMap((s) => s.trim().match(/.{1,32}/gu) || [])
    .filter(Boolean)
}
function pcm(buffer) {
  for (let i = 12; i + 8 <= buffer.length; ) {
    const len = buffer.readUInt32LE(i + 4)
    if (buffer.toString('ascii', i, i + 4) === 'data') return buffer.subarray(i + 8, i + 8 + len)
    i += 8 + len + (len % 2)
  }
  throw new Error('系统音色没有生成 WAV 音轨')
}
export function wav(parts, sampleRate = 22050) {
  const data = Buffer.concat(parts),
    header = Buffer.alloc(44)
  header.write('RIFF')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}
export function createSpeech(root, dataDir) {
  const pending = new Map()
  return async function prepare(project, signal) {
    const { source, audioId, script, voice, rate } = project
    if (source === 'audio' && !audioId) throw new Error('请先导入配音')
    if (source === 'script' && !script?.trim()) throw new Error('请先填写讲稿')
    const voiceKey = process.platform === 'linux' ? voiceRevision : voice
    const key = createHash('sha256')
      .update(JSON.stringify(source === 'audio' ? [source, audioId] : [source, script, voiceKey, rate]))
      .digest('hex')
    const dir = path.join(root, 'speech', key)
    const read = async () => ({
      ...JSON.parse(await fs.readFile(path.join(dir, 'cues.json'), 'utf8')),
      file: path.join(dir, 'audio.wav'),
    })
    try {
      return await read()
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    if (!pending.has(key))
      pending.set(
        key,
        (async () => {
          const tmp = dir + '.' + randomUUID()
          await fs.mkdir(tmp, { mode: 0o700 })
          try {
            const output = path.join(tmp, 'audio.wav'),
              cues = []
            let duration = 0
            if (source === 'audio') {
              const input = path.join(root, 'assets', audioId + '.audio')
              await run(
                await ffmpeg(dataDir, signal),
                [
                  '-nostdin',
                  '-y',
                  '-protocol_whitelist',
                  'file,pipe',
                  '-format_whitelist',
                  'wav,mp3,mov,flac,ogg,aac,aiff,matroska,webm,caf,ac3,eac3,amr',
                  '-i',
                  input,
                  '-vn',
                  '-t',
                  '601',
                  '-ac',
                  '1',
                  '-ar',
                  '22050',
                  '-c:a',
                  'pcm_s16le',
                  output,
                ],
                { signal },
              )
              duration = pcm(await fs.readFile(output)).length / 44100
            } else if (process.platform === 'linux') {
              const audio = await synthesizeLinux(splitSpeech(script), rate, tmp, dataDir, signal)
              duration = audio.duration
              cues.push(...audio.cues)
            } else {
              if (!(await voices()).some((v) => v.name === voice))
                throw new Error('此 Mac 尚未安装音色 ' + voice + '，可更换音色或导入配音')
              const parts = []
              for (const text of splitSpeech(script)) {
                signal?.throwIfAborted()
                const tempWav = path.join(tmp, 'segment.wav'),
                  tempText = path.join(tmp, 'segment.txt')
                await fs.writeFile(tempText, text)
                await run(
                  '/usr/bin/say',
                  [
                    '-v',
                    voice,
                    '-r',
                    String(rate),
                    '-o',
                    tempWav,
                    '--file-format=WAVE',
                    '--data-format=LEI16@22050',
                    '-f',
                    tempText,
                  ],
                  { signal },
                )
                const bytes = pcm(await fs.readFile(tempWav)),
                  start = duration
                duration += bytes.length / 44100
                if (duration > 600) throw new Error('每段口播最长 10 分钟，请拆分项目')
                parts.push(bytes)
                cues.push({ start, end: duration, text })
              }
              await fs.writeFile(output, wav(parts))
              await Promise.all(
                ['segment.wav', 'segment.txt'].map((n) => fs.rm(path.join(tmp, n), { force: true })),
              )
            }
            if (!(duration > 0 && duration <= 600)) throw new Error('音轨须在 10 分钟以内且包含声音')
            await fs.writeFile(path.join(tmp, 'cues.json'), JSON.stringify({ duration, cues }))
            await fs.rename(tmp, dir)
            return await read()
          } finally {
            await fs.rm(tmp, { force: true, recursive: true })
          }
        })().finally(() => pending.delete(key)),
      )
    return pending.get(key)
  }
}
