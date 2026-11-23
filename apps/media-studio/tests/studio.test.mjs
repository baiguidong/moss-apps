import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TaskStore } from '@moss/engine-apps/runtime'
import { createAvatar } from '../scripts/avatar.mjs'
import { createProjectStore, validateAvatar } from '../src/backend/projects.mjs'
import { createRenders } from '../src/backend/render.mjs'
import { createTransfer } from '../src/backend/transfer.mjs'
import { createConversation } from '../src/backend/conversation.mjs'

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-studio-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const projects = createProjectStore(root)
  await projects.init()
  return { root, projects }
}
test('original offline GLB satisfies the import contract and rejects linked textures', async () => {
  const bytes = Buffer.from(await createAvatar())
  validateAvatar(bytes)
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
  json.images = [{ uri: 'https://example.com/face.png' }]
  const chunk = Buffer.from(JSON.stringify(json)),
    header = Buffer.from(bytes.subarray(0, 20))
  header.writeUInt32LE(20 + chunk.length, 8)
  header.writeUInt32LE(chunk.length, 12)
  assert.throws(() => validateAvatar(Buffer.concat([header, chunk])), /嵌入/)
})
test('concurrent edits preserve one revision and a reopened project retains it', async (t) => {
  const { projects, root } = await temp(t)
  const p = await projects.create({ script: '原稿' })
  const results = await Promise.allSettled(
    ['甲', '乙'].map((script) => projects.save({ id: p.id, version: p.version, fields: { script } })),
  )
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected'],
  )
  assert.equal((await createProjectStore(root).get(p.id)).script, '甲')
  await assert.rejects(projects.save({ id: p.id, version: 2, fields: { avatarId: 'missing' } }), /素材不存在/)
})
test('render jobs freeze the script, grant one lease, recover the queue and honor task cancellation', async (t) => {
  const { projects, root } = await temp(t),
    transfer = await createTransfer(),
    store = new TaskStore(root)
  const opts = { root, dataDir: root, changed: () => {}, transfer }
  let renders = await createRenders(opts)
  try {
    const p = await projects.create({ script: '第一版' })
    const a = await renders.submit(p, 'agent-tool'),
      b = await renders.submit(p, 'ui')
    await projects.save({ id: p.id, version: 1, fields: { script: '修改稿' } })
    const [yes, no] = await Promise.all([renders.claim({ id: a.id }), renders.claim({ id: b.id })])
    assert.equal(yes.project.script, '第一版')
    assert.equal(no.claimed, false)
    assert.throws(() => renders.pulse({ id: a.id, lease: 'wrong' }), /其他窗口/)
    const append = (seq, body) => fetch(yes.url + '?part=' + seq, { method: 'POST', body })
    assert.equal((await append(0, 'chunk')).status, 204)
    assert.equal((await append(0, 'repeat')).status, 409)
    assert.equal((await append(2, 'gap')).status, 409)
    await renders.close()
    assert.equal((await store.get(a.id)).status, 'interrupted')
    assert.equal((await append(1, 'stale')).status, 404)
    renders = await createRenders(opts)
    assert.equal((await store.read(b.id)).status, 'queued')
    await store.cancel(b.id)
    assert.equal((await renders.claim({ id: b.id })).claimed, false)
    for (let i = 0; i < 45 && (await store.get(b.id)).status === 'queued'; i++)
      await new Promise((r) => setTimeout(r, 50))
    assert.equal((await store.get(b.id)).status, 'canceled')
    assert.equal((await store.list()).length, 2)
  } finally {
    await renders.close()
    await transfer.close()
  }
})
test('completed turns are delivered once, use an isolated binding and stay with their avatar', async (t) => {
  const { root } = await temp(t),
    calls = []
  let status = 'running'
  const host = {
    async request(protocol, name, input) {
      assert.equal(protocol, 'moss.agent/v1')
      calls.push({ name, input })
      if (name === 'binding.get') return { binding: null }
      if (name === 'session.current') return { session: null }
      if (name === 'turn.start') return { turnId: 'turn-1', status }
      if (name === 'turn.get') return { turn: { id: 'turn-1', status, resultText: '你好呀' } }
      return {}
    },
  }
  const chat = createConversation(root, host)
  const first = await chat.send({ avatarId: 'moss', text: '你好' })
  assert.ok(first.pending)
  assert.deepEqual(calls.find((c) => c.name === 'binding.update').input.patch.resources.tools, [])
  status = 'completed'
  const result = await chat.get({ avatarId: 'moss' })
  assert.equal(result.messages[1].text, '你好呀')
  assert.equal((await chat.get({ avatarId: 'moss' })).messages.length, 2)
  assert.equal(calls.filter((c) => c.name === 'turn.delivery.ack').length, 1)
})

test('an existing role chat sends the original text and updates its binding only when the style changes', async (t) => {
  const { root } = await temp(t)
  const turns = [], styles = []
  let binding = { revision: 1, policy: {
    contextScope: 'app', inheritDefault: false, replyMode: 'ai_auto', permissionMode: 'default',
    resources: { tools: [], skills: [], connectors: [] }, session: { mode: 'fixed' },
  } }
  const host = {
    async request(_protocol, name, input) {
      if (name === 'binding.get') return { binding }
      if (name === 'binding.update') {
        assert.equal(input.expectedRevision, binding.revision)
        styles.push(input.patch.session.responseStyle)
        binding = { revision: binding.revision + 1, policy: input.patch }
        return { binding }
      }
      if (name === 'session.current') return { session: { id: 'original-session' } }
      if (name === 'turn.start') {
        assert.equal(input.externalConversationId, 'studio:moss')
        turns.push(input.text)
        return { turnId: input.externalEventId }
      }
      if (name === 'turn.get') return { turn: { id: input.turnId, status: 'completed', resultText: '收到' } }
      if (name === 'turn.delivery.ack') return {}
      assert.fail(`Unexpected request: ${name}`)
    },
  }
  let chat = createConversation(root, host)
  const avatarId = 'moss'
  await chat.send({ avatarId, text: '你好' })
  chat = createConversation(root, host)
  await chat.send({ avatarId, text: '接着说' })
  await chat.persona({ avatarId, persona: '  用粤语回答  ' })
  const literalText = '角色表达偏好：这是我的原话\n\n用户：请保留这行'
  await chat.send({ avatarId, text: literalText })
  await chat.persona({ avatarId, persona: '' })
  const result = await chat.send({ avatarId, text: '谢谢' })
  assert.deepEqual(styles, ['亲切、简洁地用中文回答。', '用粤语回答', ''])
  assert.deepEqual(turns, ['你好', '接着说', literalText, '谢谢'])
  assert.deepEqual(result.messages.filter((m) => m.role === 'user').map((m) => m.text), turns)
})

test('chat migration retains the previous conversation once and drops its pending turn', async (t) => {
  const { root } = await temp(t)
  const chat = createConversation(root, { request() { assert.fail('Historical turns must not call Moss') } })
  const previous = { avatarId: 'moss', persona: '用中文回答', pending: { turnId: 'old' },
    messages: [{ id: 'first', role: 'assistant', text: '上次的内容' }] }
  await chat.importHistory(previous)
  await chat.importHistory(previous)
  const result = await chat.get({ avatarId: 'moss' })
  assert.deepEqual(result.messages, previous.messages)
  assert.equal(result.persona, previous.persona)
  assert.equal(result.pending, null)
})
