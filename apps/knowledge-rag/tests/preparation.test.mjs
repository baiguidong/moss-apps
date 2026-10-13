import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { KnowledgeService } from '../src/backend/service.mjs'
import { Preparation, cleanOutput, lineCollector } from '../src/backend/preparation.mjs'

test('restart skips installed steps and reports elapsed time, real bytes, failure, and bounded diagnostics', () => {
  let now = 1000
  const progress = new Preparation(false, () => {}, () => now)
  progress.step('model', '校验模型')
  assert.deepEqual(progress.snapshot().steps.slice(0, 2).map(step => step.state), ['cached', 'cached'])
  progress.output('MOSS_PROGRESS {"detail":"下载模型","completed":1048576,"total":2097152,"file":"model.onnx"}')
  now += 31000
  assert.equal(progress.snapshot().idleMs, 31000)
  assert.equal(progress.snapshot().download.completed, 1048576)
  progress.step('service', '启动服务')
  assert.equal(progress.snapshot().download, null)
  for (let index = 0; index < 30; index++) progress.output(`line ${index}`)
  assert.equal(progress.snapshot().logs.length, 24)
  progress.finish('failed'); now += 10000
  assert.equal(progress.snapshot().elapsedMs, 31000)
  assert.equal(progress.snapshot().steps.find(step => step.id === 'service').state, 'failed')
  progress.output('late output')
  assert.equal(progress.snapshot().logs.at(-1), 'line 29')
})

test('split JSON/CR output is assembled and credentials are removed before display', () => {
  const lines = [], collector = lineCollector(line => lines.push(line))
  collector.write('MOSS_PROG'); collector.write('RESS {"detail":"模型"}\rdown'); collector.write('loading\nlast')
  collector.end()
  assert.deepEqual(lines, ['MOSS_PROGRESS {"detail":"模型"}', 'downloading', 'last'])
  const safe = cleanOutput('\x1b[31mhttps://user:secret@host.test/file?token=secret Bearer secret\x1b[0m')
  assert.equal(safe, 'https://host.test/file Bearer [hidden]')
})

test('live child output reaches status before exit, cancellation settles, and retry has fresh progress', async () => {
  const changes = []
  const service = new KnowledgeService({ dataDir: '/unused', resourcesDir: '/unused', enginePython: process.execPath,
    onChanged: state => changes.push(state) })
  service.start = async () => {
    service.step('service', '正在启动')
    await service.command(process.execPath, ['-e', 'process.stdout.write("MOSS_PROGRESS {\\"detail\\":\\"正在检查索引\\"}\\n");setTimeout(()=>{},30000)'])
  }
  try {
    const initial = service.begin('start')
    assert.equal(initial.state, 'starting')
    for (let attempt = 0; attempt < 100 && !changes.some(state => state.preparation?.detail === '正在检查索引'); attempt++) await delay(20)
    assert.ok(changes.some(state => state.preparation?.detail === '正在检查索引'))
    assert.ok(service.operation)
    const cancelled = await service.cancelPreparation()
    assert.match(cancelled.message, /已取消/)
    assert.equal(cancelled.preparation.steps.find(step => step.id === 'service').state, 'cancelled')
    service.start = async () => { service.step('service', '再试一次'); throw new Error('failed https://u:secret@host/file?token=secret') }
    service.begin('start'); await service.operation
    assert.equal(service.state, 'failed')
    assert.match(service.message, /本地服务未完成/)
    assert.equal(service.status().preparation.logs.length, 0)
    assert.ok(!service.error.includes('secret'))
  } finally { await service.close() }
})
