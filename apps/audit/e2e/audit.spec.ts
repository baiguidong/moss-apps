import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLocalAuditService } from '../src/backend/service.mjs'
import { createResultTransport } from '../src/backend/transport'

for (const themeMode of ['light', 'dark']) test(`real audit data, navigation, decisions, rules and history (${themeMode})`, async ({ page }, testInfo) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-browser-'))
  const sessions = [{ id: 'fixture-session', title: '部署脚本检查', workspace: '/fixture', agentMode: 'local', createdAt: 1, updatedAt: 2,
    history: [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'rm -rf /fixture/archive' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '已执行' }] } }] }]
  const service = createLocalAuditService({ dbPath: path.join(home, 'audit.db'), getLocalSessions: () => sessions })
  const transfer = createResultTransport(), opened: any[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await service.runAudit()
  service.recordEvent({ sessionId: 'fixture-session', eventType: 'turn_reverted', details: { status: 'completed' }, sourceSession: { history: [{ type: 'user', prompt: '保留的完整撤销历史' }] } })
  try {
    await page.exposeFunction('auditAction', async (name: string, input: any) => {
      if (name === 'result.read') return transfer.read(input)
      if (name === 'result.release') return transfer.release(input.id)
      const methods: Record<string, () => unknown> = {
        'dashboard.get': () => service.getDashboard(), 'audit.run': () => service.runAudit(input),
        'event.get': () => service.getEvent(input), 'rule.update': () => service.updateRule(input),
        'finding.update': () => service.updateFinding(input), 'findings.update': () => service.updateFindings(input),
        'session.open': () => { opened.push(input); return { opened: true } },
      }
      return transfer.pack(await methods[name]())
    })
    await page.addInitScript(mode => {
      window.mossApp = {
        actions: { invoke: async (name: string, input: unknown) => ({ ok: true, result: await (window as any).auditAction(name, input) }) },
        events: { on: () => () => {} }, app: { getInfo: async () => ({ appearance: { themeMode: mode } }) } } as any
    }, themeMode)
    await page.goto('/')
    await expect(page.getByText('部署脚本检查', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', themeMode)
    await page.getByRole('button', { name: '发现', exact: true }).first().click()
    await expect(page.getByRole('checkbox', { name: '全选当前发现' })).toBeVisible()
    await page.getByRole('checkbox', { name: '全选当前发现' }).check()
    await page.getByLabel('批量设置发现状态').selectOption('resolved')
    await page.getByRole('button', { name: '应用', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('已批量更新')
    expect(service.getDashboard().findings[0].status).toBe('resolved')
    await page.locator('summary').first().click()
    await page.getByRole('button', { name: '在会话中定位' }).click()
    await expect.poll(() => opened.length).toBe(1)
    expect(opened[0].toolUseId).toBe('tool-1')
    await page.getByPlaceholder('搜索审计数据').fill('不存在的结果')
    await expect(page.getByRole('checkbox', { name: '全选当前发现' })).toHaveCount(0)
    await page.getByPlaceholder('搜索审计数据').fill('')
    await page.screenshot({ path: testInfo.outputPath(`findings-${themeMode}.png`), fullPage: true })
    await page.getByRole('button', { name: '规则', exact: true }).first().click()
    await page.getByRole('button', { name: '参数', exact: true }).first().click()
    await page.locator('textarea').fill('[')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText(/正则|expression|Invalid/).first()).toBeVisible()
    await page.locator('textarea').fill('rm')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('textarea')).toHaveCount(0)
    expect(service.getDashboard().rules.find(rule => rule.id === 'destructive-command')?.config.patterns).toEqual(['rm'])
    await page.getByRole('button', { name: '关闭提示', exact: true }).click()
    await page.getByRole('button', { name: '重新审计', exact: true }).click()
    await expect(page.getByRole('button', { name: '重新审计', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '操作事件', exact: true }).click()
    await page.getByRole('button', { name: '查看', exact: true }).click()
    await expect(page.getByText(/保留的完整撤销历史/)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`event-${themeMode}.png`), fullPage: true })
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('button', { name: '会话', exact: true }).first().click()
    await page.setViewportSize({ width: 480, height: 800 })
    await page.screenshot({ path: testInfo.outputPath(`narrow-${themeMode}.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally { service.close(); transfer.close(); await fs.rm(home, { recursive: true, force: true }) }
})

test('missing Host shows an actionable error', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('请在 Moss 中打开审计 App。', { exact: true })).toBeVisible()
})
