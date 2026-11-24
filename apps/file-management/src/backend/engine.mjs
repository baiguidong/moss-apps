import fs from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { ensureBinary, existingPaths, run, argv } from '@moss/engine-apps/runtime'
import spec from '../../resources/engine.json' with { type: 'json' }
import commands from '../backup-commands.json' with { type: 'json' }

const safeString = value => typeof value === 'string' && value.length > 0 && !value.includes('\0')
const repo = async value => {
  if (!safeString(value) || !path.isAbsolute(value)) throw new Error('请选择备份库的绝对路径')
  const real = await fs.realpath(value)
  if (!(await fs.stat(real)).isDirectory()) throw new Error('备份库必须是目录')
  return real
}
const snapshot = value => {
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(value || '')) throw new Error('快照 ID 无效')
  return value
}
const report = async (ctx, name, text) => {
  const file = path.join(ctx.directory, name)
  await fs.writeFile(file, text)
  return { name, path: file, kind: name.endsWith('.json') ? 'json' : 'text' }
}
const parseLines = text => text.split(/\r?\n/).filter(Boolean).map(line => {
  try { return JSON.parse(line) } catch { return { message: line } }
})
const maxEventChars = 256 * 1024

async function writeAll(handle, bytes) {
  for (let offset = 0; offset < bytes.length;) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null)
    if (!bytesWritten) throw new Error('无法写入备份输出')
    offset += bytesWritten
  }
}

function backupEvents(progress = async () => {}, operation = 'backup') {
  const decoder = new StringDecoder('utf8'), messages = []
  let line = '', skippingLine = false, summary, lastProgress = 0, progressWrite = Promise.resolve()
  const acceptLine = value => {
    if (!value.trim()) return
    let event
    try { event = JSON.parse(value) } catch { return }
    if (!event || typeof event !== 'object' || Array.isArray(event)) return
    if (event.message_type === 'summary') summary = event
    else if (event.message_type === 'error' && messages.length < 100) messages.push(event)
    else if (event.message_type === 'status' && Date.now() - lastProgress > 1000) {
      lastProgress = Date.now()
      const files = Number(operation === 'restore' ? event.files_restored : event.files_done) || 0
      const fraction = Number(event.percent_done ?? (event.total_files ? files / event.total_files : 0))
      const percent = Math.min(100, Math.max(0, Math.round(fraction * 100) || 0))
      const label = operation === 'restore' ? '恢复中' : '备份中'
      const amount = operation === 'restore' ? `${files} 项` : `${files} 个文件`
      progressWrite = progressWrite.then(() => progress(`${label} · ${percent}% · ${amount}`)).catch(() => {})
    }
  }
  const acceptText = text => {
    for (let offset = 0; offset < text.length;) {
      const end = text.indexOf('\n', offset)
      const fragment = text.slice(offset, end < 0 ? undefined : end)
      if (!skippingLine) {
        if (line.length + fragment.length > maxEventChars) { line = ''; skippingLine = true }
        else line += fragment
      }
      if (end < 0) break
      if (!skippingLine) acceptLine(line)
      line = ''; skippingLine = false; offset = end + 1
    }
  }
  return {
    accept: bytes => acceptText(decoder.write(bytes)),
    async finish() {
      acceptText(decoder.end())
      if (!skippingLine) acceptLine(line)
      await progressWrite
      return { summary, messages }
    },
  }
}

/** Save every stdout byte while retaining only parsed events in memory. */
export async function runBackupCommand(executable, args, ctx, operation = 'backup') {
  const reportPath = path.join(ctx.directory, '运行输出.txt')
  const report = await fs.open(reportPath, 'w')
  const events = backupEvents(ctx.progress, operation)
  try {
    const execution = await run(executable, args, { signal: ctx.signal, log: ctx.log,
      captureStdout: false, allowFailure: true,
      onStdout: async (_text, bytes) => {
        events.accept(bytes)
        await writeAll(report, bytes)
      },
    })
    const parsed = await events.finish()
    return { ...execution, ...parsed, reportPath }
  } finally { await report.close() }
}

export async function buildArgs(input) {
  if (!input || !commands.includes(input.command)) throw new Error('请选择备份操作')
  if (input.command === 'raw') {
    const args = argv(input.args || [])
    if (!args.length) throw new Error('请输入 Restic 参数')
    if (args.some(arg => /^(--password|--password-file|--password-command)(=|$)/.test(arg))) throw new Error('备份密码由 Moss 凭据库管理')
    if (input.confirmChanges !== true && args.some(arg => /^(forget|prune|rewrite|unlock|migrate|repair|recover)$/.test(arg))) throw new Error('此命令会修改备份库，请确认操作范围')
    return { args, roots: [] }
  }
  const root = await repo(input.repo)
  const prefix = ['-r', root]
  if (input.command === 'init') return { args: [...prefix, 'init'], roots: [root] }
  if (input.command === 'backup') {
    const sources = await existingPaths(input.paths, 'directory')
    return { args: [...prefix, 'backup', '--json', ...sources], roots: sources }
  }
  if (input.command === 'snapshots') return { args: [...prefix, 'snapshots', '--json'], roots: [root] }
  if (input.command === 'ls') return { args: [...prefix, 'ls', '--json', snapshot(input.snapshot)], roots: [root] }
  if (input.command === 'check') return { args: [...prefix, 'check'], roots: [root] }
  if (input.command === 'restore') {
    const target = (await existingPaths([input.target], 'directory'))[0]
    if (input.overwrite !== undefined && !['always', 'never'].includes(input.overwrite)) throw new Error('请选择同名文件的处理方式')
    return { args: [...prefix, 'restore', snapshot(input.snapshot), '--target', target, '--json',
      ...(input.overwrite ? ['--overwrite', input.overwrite] : [])], roots: [target] }
  }
  throw new Error('不支持的备份操作')
}

export default {
  id: 'restic', spec,
  workerEnv(context) { return { RESTIC_PASSWORD: context.secrets?.password || '' } },
  requireReady(context) { if (!context.secrets?.password) throw new Error('请先在页面中保存备份密码') },
  async catalog({ dataDir, prepare }) {
    if (prepare) await ensureBinary(spec, dataDir)
    return { version: spec.version, commands }
  },
  async validate(input) { await buildArgs(input) },
  async execute(input, ctx) {
    if (!process.env.RESTIC_PASSWORD) throw new Error('未配置备份密码')
    await ctx.progress('准备 Restic 引擎')
    const binary = await ensureBinary(spec, ctx.dataDir, ctx.signal)
    const { args, roots } = await buildArgs(input)
    await ctx.record?.({ argv: args })
    const progressLabels = { init: '正在创建备份库', backup: '正在读取源文件', snapshots: '正在读取快照',
      ls: '正在读取快照中的文件', check: '正在校验备份库', restore: '正在准备恢复' }
    const completionLabels = { init: '备份库已创建', backup: '备份已完成', snapshots: '快照已读取',
      ls: '快照文件已读取', check: '备份库校验通过', restore: '恢复已完成' }
    await ctx.progress(progressLabels[input.command] || '正在执行高级操作')
    const streaming = input.command === 'backup' || input.command === 'restore'
    const execution = streaming
      ? await runBackupCommand(binary, args, ctx, input.command)
      : await run(binary, args, { signal: ctx.signal, log: ctx.log, allowFailure: true })
    const output = execution.stdout.trim()
    const artifacts = [streaming
      ? { name: '运行输出.txt', path: execution.reportPath, kind: 'text', size: (await fs.stat(execution.reportPath)).size }
      : await report(ctx, '运行输出.txt', execution.stdout)]
    if (execution.stderr) artifacts.push(await report(ctx, '错误输出.txt', execution.stderr))
    let result = { text: output.slice(0, 200000), exitCode: execution.code }
    if (input.command === 'snapshots') {
      try { result = { snapshots: JSON.parse(output), exitCode: execution.code } } catch {}
    } else if (input.command === 'ls') {
      const entries = parseLines(output)
      result = { entries: entries.slice(0, 1000), entriesTruncated: entries.length > 1000, exitCode: execution.code }
    } else if (streaming) {
      result = { summary: execution.summary, messages: execution.messages, exitCode: execution.code }
      if (input.command === 'restore' && execution.summary) result.text = `已恢复 ${execution.summary.files_restored ?? 0} 项`
      // The shared artifact viewer opens the first text result automatically. A large
      // raw log exceeds its preview limit, so lead with a small readable summary.
      artifacts.unshift(await report(ctx, input.command === 'backup' ? '备份摘要.json' : '恢复摘要.json', JSON.stringify({
        summary: execution.summary ?? null, errorCount: execution.messages.length,
        exitCode: execution.code,
      }, null, 2)))
    }
    const status = execution.code === 0 ? 'succeeded' : input.command === 'backup' && execution.code === 3 ? 'partial' : 'failed'
    return { status, argv: args, artifacts, result, readRoots: roots,
      message: status === 'partial' ? '备份部分完成：部分源文件未读到' : status === 'failed' ? 'Restic 执行失败：' + (execution.stderr.trim() || String(execution.code)).slice(-800) : completionLabels[input.command] || '操作完成' }
  },
}
