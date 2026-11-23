import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { serialQueue, readJson, saveJson, validId } from './projects.mjs'

export function createConversation(root, host) {
  const serial = serialQueue(),
    request = (op, input) => host.request('moss.agent/v1', op, input)
  const file = (id) => path.join(root, 'chat', (id === 'moss' ? id : validId(id)) + '.json')
  const save = (state) => saveJson(file(state.avatarId), state)
  async function load(avatarId) {
    try {
      return await readJson(file(avatarId))
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      return { avatarId, messages: [], persona: '亲切、简洁地用中文回答。', pending: null, error: '' }
    }
  }
  const conversation = (id) => 'studio:' + id
  async function refresh(state) {
    const p = state.pending
    if (!p) return state
    const externalConversationId = conversation(state.avatarId)
    if (!p.turnId) {
      const { turns } = await request('turn.list', { externalConversationId, limit: 100 })
      p.turnId = turns.find((t) => t.externalEventId === p.eventId)?.id
      if (!p.turnId) {
        state.pending = null
        state.error = '上次发送中断，请重新发送'
        await save(state)
        return state
      }
    }
    const { turn } = await request('turn.get', { turnId: p.turnId })
    if (turn && ['completed', 'cancelled', 'failed', 'rejected', 'human'].includes(turn.status)) {
      if (turn.status === 'completed')
        state.messages.push({
          id: turn.id,
          role: 'assistant',
          text: turn.reviewedText || turn.resultText || '这一轮已完成。',
        })
      state.pending = null
      state.error =
        turn.status === 'failed' || turn.status === 'rejected'
          ? turn.error || 'Moss 未完成回复，请检查模型配置'
          : ''
      await save(state)
      if (turn.status === 'completed')
        await request('turn.delivery.ack', {
          turnId: turn.id,
          externalConversationId,
          ok: true,
          externalMessageId: turn.id,
        }).catch(() => {})
    }
    return state
  }
  return {
    importHistory: old => serial(async () => {
      const current = await load(old.avatarId)
      const ids = new Set(current.messages.map(message => message.id))
      const messages = old.messages.filter(message => typeof message.id === 'string'
        && ['user', 'assistant'].includes(message.role) && typeof message.text === 'string' && !ids.has(message.id))
      if (!messages.length) return
      if (!current.messages.length && typeof old.persona === 'string') current.persona = old.persona
      current.messages = messages.concat(current.messages).slice(-200)
      await save(current)
    }),
    get: ({ avatarId }) => serial(async () => refresh(await load(avatarId))),
    persona: ({ avatarId, persona }) =>
      serial(async () => {
        const state = await load(avatarId)
        state.persona = persona
        await save(state)
        return state
      }),
    send: ({ avatarId, text }) =>
      serial(async () => {
        const state = await refresh(await load(avatarId))
        if (state.pending) throw new Error('当前角色正在回复')
        if (!text.trim()) throw new Error('请输入消息')
        const externalConversationId = conversation(avatarId),
          externalUserId = 'studio-user',
          eventId = randomUUID()
        const { binding } = await request('binding.get', { externalConversationId })
        const patch = {
          contextScope: 'app',
          inheritDefault: false,
          replyMode: 'ai_auto',
          permissionMode: 'default',
          resources: { tools: [], skills: [], connectors: [] },
          session: { mode: 'fixed', responseStyle: state.persona.trim() },
        }
        if (
          !binding ||
          binding.policy?.contextScope !== 'app' ||
          binding.policy?.inheritDefault !== false ||
          binding.policy?.replyMode !== patch.replyMode ||
          binding.policy?.permissionMode !== patch.permissionMode ||
          binding.policy?.session?.mode !== patch.session.mode ||
          binding.policy?.session?.responseStyle !== patch.session.responseStyle ||
          ['tools', 'skills', 'connectors'].some((key) => binding.policy?.resources?.[key]?.length)
        )
          await request('binding.update', {
            externalConversationId,
            expectedRevision: binding?.revision || 0,
            patch,
          })
        const { session } = await request('session.current', { externalUserId, externalConversationId })
        if (!session)
          await request('session.create', {
            externalUserId,
            externalConversationId,
            externalEventId: eventId + ':session',
            title: '多媒体工坊 · 角色对话',
          })
        state.messages.push({ id: eventId, role: 'user', text })
        state.messages = state.messages.slice(-200)
        state.pending = { eventId, turnId: null }
        state.error = ''
        await save(state)
        const result = await request('turn.start', {
          externalUserId,
          externalConversationId,
          externalEventId: eventId,
          source: 'human',
          text,
        })
        state.pending.turnId = result.turnId
        await save(state)
        return refresh(state)
      }),
    stop: ({ avatarId }) =>
      serial(async () => {
        const state = await refresh(await load(avatarId))
        if (state.pending?.turnId) {
          await request('turn.abort', { turnId: state.pending.turnId })
          return refresh(state)
        }
        return state
      }),
  }
}
