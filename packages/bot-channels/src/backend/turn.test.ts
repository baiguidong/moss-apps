import { expect, test } from 'bun:test'
import { AppServiceError, type AppBackendContext } from '@moss/app-sdk'
import { createTurnSender } from './turn'

const input = { externalConversationId: 'weixin:fixture', externalUserId: 'member', externalEventId: 'one', text: '测试' }
function host(reject: (turn: Record<string, unknown>) => string | undefined, allowedTools?: string[]) {
  const calls: Record<string, unknown>[] = []
  const request = async (turn: Record<string, unknown>) => {
    calls.push(turn)
    const message = reject(turn)
    if (message) throw new AppServiceError('APP_INVALID_ACTION_INPUT', message)
    return { accepted: true, turnId: 'test' }
  }
  const context = {
    config: { allowedTools },
    host: { request: (_protocol: string, _method: string, turn: Record<string, unknown>) => request(turn) },
    agent: { request: (_method: string, turn: Record<string, unknown>) => request(turn) },
  } as unknown as AppBackendContext
  return { sender: createTurnSender(context, true, true), calls }
}

test('retry only a rejected progress option and remember host support', async () => {
  const { sender, calls } = host(turn => turn.progress ? 'turn.start contains an unknown field: progress' : undefined)
  await sender.start(input)
  await sender.start({ ...input, externalEventId: 'two' })
  expect(calls).toEqual([{ ...input, progress: { thinking: true, tools: true } }, input, { ...input, externalEventId: 'two' }])
  expect(sender.progressUnavailable).toBe(true)
})

test('keep tool restrictions on every attempt and surface other failures', async () => {
  const { sender, calls } = host(turn => turn.progress ? 'turn.start contains an unknown field: progress' : 'turn.start contains an unknown field: toolAllowlist', ['Read'])
  await expect(sender.start(input)).rejects.toThrow('toolAllowlist')
  expect(calls.map(turn => turn.toolAllowlist)).toEqual([['Read'], ['Read']])
  const other = host(() => 'unrelated failure')
  await expect(other.sender.start(input)).rejects.toThrow('unrelated failure')
  expect(other.calls).toHaveLength(1)
})
