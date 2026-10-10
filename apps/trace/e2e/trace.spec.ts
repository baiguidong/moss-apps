import { test, expect } from '@playwright/test'
import { fixture, call } from '../tests/fixture'
import { createTraceStore } from '../src/backend/store'
import { closeTraceStore } from '../src/backend/api/traceStore'
import { createResultTransport } from '../src/backend/backend'

test('real App reader drives list, full prompt, filters, refresh, theme and deletion', async ({ page }) => {
  const f = await fixture(); const transfer = createResultTransport()
  try {
    await f.append(call({ status: 'error', error: { name: 'NetworkError', message: 'fixture network error' } })); await f.metadata()
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
  await expect(page.getByText('请在 Moss 中打开 Trace App。')).toBeVisible()
})
