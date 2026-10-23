import { test, expect } from '@playwright/test'
import { fixture, call } from '../tests/fixture'
import { createTraceStore } from '../src/backend/store'
import { closeTraceStore } from '../src/backend/api/traceStore'
import { createResultTransport } from '../src/backend/backend'
import fs from 'node:fs/promises'
import path from 'node:path'

test('real App reader drives list, full prompt, filters, refresh, theme and deletion', async ({ page }) => {
  const f = await fixture(); const transfer = createResultTransport()
  try {
    await f.append(call({ status: 'error', error: { name: 'NetworkError', message: 'fixture network error' },
      metadata: { promptDiagnostics: { version: 1, metric: 'utf8-content-bytes', unmeasuredBlocks: 1, rows: [
        { location: 'system[0].text', kind: 'system', characters: 120, bytes: 240 },
        { location: 'messages[0].content', kind: 'message', characters: 120, bytes: 240, duplicateOf: 'system[0].text' },
      ] } },
    })); await f.metadata()
    const store = createTraceStore(f.directory); const invoked: string[] = []
    await page.exposeFunction('traceAction', async (name: string, input: any) => {
      invoked.push(name)
      if (name === 'result.read') return transfer.read(input)
      if (name === 'result.release') return transfer.release(input.id)
      const result = await store.request(name, input)
      if (name === 'traces.list') Object.assign(result, { captureStatus: { enabled: true, droppedRecords: 0 } })
      return transfer.pack(result)
    })
    await page.addInitScript(() => {
      window.mossApp = {
        actions: { invoke: async (name: string, input: unknown) => ({ ok: true, result: await (window as any).traceAction(name, input) }) },
        app: { getInfo: async () => ({ appearance: { themeMode: 'dark' } }) } } as any
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: /^排查配置/ })).toBeVisible()
    await expect(page.getByRole('checkbox')).toHaveCount(0)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByRole('button', { name: /^排查配置/ }).click()
    await expect(page.getByTestId('trace-tree')).toBeVisible()
    await page.getByRole('button', { name: '错误', exact: true }).click()
    await page.getByRole('treeitem').filter({ hasText: 'fixture-model' }).first().click()
    await expect(page.getByTestId('trace-call-error')).toContainText('fixture network error')
    await page.getByRole('button', { name: /系统提示词/ }).click()
    await expect(page.getByText('系统提示词末尾标记', { exact: true })).toBeVisible()
    expect(invoked).toContain('traces.call')
    await page.getByRole('button', { name: '提示词组成诊断' }).click()
    await expect(page.getByTestId('prompt-diagnostics')).toContainText('完全重复')
    await expect(page.getByTestId('prompt-diagnostics')).toContainText('统计不完整')
    await page.setViewportSize({ width: 480, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByTestId('prompt-diagnostics').locator('table').scrollIntoViewIfNeeded()
    await page.screenshot({ path: '../../artifacts/moss.trace/prompt-diagnostics-narrow.png', fullPage: true })
    await page.getByTestId('trace-back').click()
    await f.metadata('更新后标题')
    await page.getByRole('button', { name: '刷新 Trace' }).click()
    await expect(page.getByRole('button', { name: /^更新后标题/ })).toBeVisible()
    await page.setViewportSize({ width: 480, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: /删除/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click()
    await expect(page.getByRole('button', { name: /^更新后标题/ })).toHaveCount(0)
    expect((await store.request('traces.list') as any).total).toBe(0)
  } finally { transfer.close(); closeTraceStore(); await f.cleanup() }
})

test('standalone page explains missing Host instead of showing fake records', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('请在 Moss 中打开调用追踪。')).toBeVisible()
})

test('overview counts failed calls once and uses real parallel tool execution intervals', async ({ page }) => {
  const f = await fixture(); const transfer = createResultTransport()
  try {
    await f.append(call({ status: 'ok', startedAt: '2026-09-30T10:00:01.000Z',
      completedAt: '2026-09-30T10:00:05.000Z', durationMs: 4000,
      response: { status: 200, headers: {}, body: { contentType: 'json', bytes: 2, sha256: 'response', preview: '{}', truncated: false } } }))
    const identities = ['failed-a', 'failed-b', 'success-a', 'success-b']
    const messages = [{ id: 'user', type: 'user', content: '你好', timestamp: '2026-09-30T10:00:00.000Z' },
      ...identities.flatMap((identity, index) => [
        { id: `use-${identity}`, type: 'tool_use', timestamp: '2026-09-30T10:00:00.000Z', timestampSource: 'inherited',
          content: [{ type: 'tool_use', id: identity, name: 'Read', input: {} }] },
        { id: `result-${identity}`, type: 'tool_result', timestamp: '2026-09-30T10:00:05.200Z',
          content: [{ type: 'tool_result', tool_use_id: identity, content: 'result', is_error: index < 2 }] },
      ])]
    await fs.writeFile(path.join(f.scope, 'sessions/session-1.json'), JSON.stringify({ schemaVersion: 1,
      session: { id: 'desktop', title: '工具统计回归', projectPath: '/fixture', workDir: '/fixture' }, messages }))
    for (const [index, identity] of identities.entries()) {
      await fs.appendFile(path.join(f.scope, 'traces/session-1.jsonl'), JSON.stringify({ schemaVersion: 1, type: 'event', event: {
        id: `${identity}-completed`, sessionId: 'session-1', timestamp: '2026-09-30T10:00:05.100Z',
        phase: 'tool_execution_completed', severity: index < 2 ? 'error' : 'info',
        metadata: { toolUseId: identity, startedAt: '2026-09-30T10:00:05.000Z', durationMs: 100, status: index < 2 ? 'error' : 'ok' },
      } }) + '\n')
    }
    const store = createTraceStore(f.directory)
    await page.exposeFunction('traceAction', async (name: string, input: any) => {
      if (name === 'result.read') return transfer.read(input)
      if (name === 'result.release') return transfer.release(input.id)
      const result = await store.request(name, input)
      if (name === 'traces.list') Object.assign(result, { captureStatus: { enabled: true, droppedRecords: 0 } })
      return transfer.pack(result)
    })
    await page.addInitScript(() => {
      window.mossApp = { actions: { invoke: async (name: string, input: unknown) => ({ ok: true, result: await (window as any).traceAction(name, input) }) },
        app: { getInfo: async () => ({ appearance: { themeMode: 'light' } }) } } as any
    })
    await page.goto('/')
    await page.getByRole('button', { name: /^工具统计回归/ }).click()
    const overview = page.getByTestId('trace-overview')
    await expect(overview).toBeVisible()
    const stat = (label: string) => overview.getByText(label, { exact: true }).locator('..')
    await expect(stat('错误')).toHaveText('错误2')
    await expect(stat('工具调用')).toHaveText('工具调用4')
    await expect(stat('工具耗时')).toHaveText('工具耗时100ms')
    await expect(stat('模型耗时')).toHaveText('模型耗时4.00s')
  } finally { transfer.close(); closeTraceStore(); await f.cleanup() }
})
