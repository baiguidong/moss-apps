// Build-time dependency preparation only. Runtime never downloads assets.
import fs from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {pipeline} from 'node:stream/promises'
import {hash} from './runtime.mjs'
import {platformAsset} from './platform.mjs'

const preparing = new Map()
export async function prepareBinary(spec, dataDir, signal) {
  spec = platformAsset(spec)
  const directory = path.join(dataDir, 'engines', spec.id, spec.version)
  const binary = path.join(directory, spec.executable)
  if (await fs.stat(binary).catch(() => null)) {
    if (await hash(binary) === spec.binarySha256) { await fs.chmod(binary, 0o755); return binary }
    throw new Error('引擎文件校验失败，请移除损坏的引擎缓存后重试')
  }
  const key = binary
  if (preparing.has(key)) return preparing.get(key)
  const preparation = (async () => {
    const temp = `${directory}.${randomUUID()}`
    await fs.mkdir(temp, { recursive: true, mode: 0o700 })
    try {
      const archive = path.join(temp, 'download')
      const response = await fetch(spec.url, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(900000)]) })
      if (!response.ok || !response.body) throw new Error(`引擎下载失败：HTTP ${response.status}`)
      await pipeline(response.body, createWriteStream(archive, { mode: 0o600 }))
      if (await hash(archive) !== spec.sha256) throw new Error('下载内容校验失败，请重试')
      const output = path.join(temp, spec.executable)
      if (spec.archive === 'binary') await fs.rename(archive, output)
      else {
        // Extract only the pinned executable, never arbitrary archive entries.
        await new Promise((resolve, reject) => {
          const child = spawn(spec.archive === 'zip' ? '/usr/bin/unzip' : '/usr/bin/tar', spec.archive === 'zip' ? ['-p', archive, spec.member] : ['-xOf', archive, spec.member], { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
          let error = ''; child.stderr.on('data', x => { error += x })
          const streamed = pipeline(child.stdout, createWriteStream(output, { mode: 0o700 }))
          child.once('error', reject); child.once('close', async code => { try { await streamed; if (code) throw new Error(error); resolve() } catch (error) { reject(error) } })
        })
      }
      if (await hash(output) !== spec.binarySha256) throw new Error('解包后的引擎校验失败')
      signal?.throwIfAborted()
      await fs.chmod(output, 0o755); await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await fs.rename(output, binary)
      return binary
    } finally { await fs.rm(temp, { recursive: true, force: true }) }
  })().finally(() => preparing.delete(key))
  preparing.set(key, preparation); return preparation
}
