import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import manifest from '../app.moss.json' with { type: 'json' }
import { MEMORY } from '../src/contracts'
const DEFAULT_CONFIG = { type: 'stdio' as const, disabledTools: [] as string[] }
import type { Catalog, Input, Method } from '../src/contracts'
import type { GraphInput } from '../src/contracts'
import { selectGraph, type GraphRecords } from '../src/lib/graph-data'

const screenshots = path.resolve(import.meta.dirname, '../../..', `artifacts/moss.memory/screenshots/${manifest.version}`)
async function fixture(page: Page, failed = false, empty = false) {
  const calls: (Method | 'graph.read')[] = []
  const graph: GraphRecords = { entities: empty ? [] : [
    { name: '小林', entityType: '人物', observations: ['项目负责人', '<script>只是记忆文字</script>'] },
    { name: '咖啡店网站', entityType: '项目', observations: ['首页草图已完成'] },
    { name: '菜单页面', entityType: '需求', observations: ['展示饮品和价格'] },
  ], relations: empty ? [] : [
    { from: '小林', to: '咖啡店网站', relationType: '负责' },
    { from: '咖啡店网站', to: '菜单页面', relationType: '包含' },
  ] }
  let graphFailure = false
  const catalog: Catalog = { memoryFile: '/tmp/Moss Data/memory/knowledge-graph.jsonl', preparation: failed ? { state: 'failed', error: '记忆文件无法写入，请检查数据目录权限。' } : { state: 'ready' }, servers: [{
    name: MEMORY, enabled: true, credentialsMissing: false, updatedAt: 1, config: structuredClone(DEFAULT_CONFIG),
    check: { state: failed ? 'failed' : 'connected', checkedAt: 1, tools: [{ name: 'delete_entities', description: '点击网页元素', disabled: false }] },
  }] }
  let polling = 0, rejectReconnect = false
  await page.exposeFunction('memoryInvoke', async (method: Method | 'graph.read', input: Input & GraphInput) => {
    calls.push(method)
    if (method === 'graph.read') return graphFailure ? { ok: false, error: { message: '读取图谱失败，请重试。' } } : { ok: true, data: selectGraph(graph, input) }
    if (method === 'servers.inspect' && rejectReconnect) {
      rejectReconnect = false
      return { ok: false, error: { message: '重连请求失败，请重试。' } }
    }
    if (method === 'servers.save') {
      catalog.servers[0].config = { ...catalog.servers[0].config, disabledTools: input.disabledTools! }
      catalog.servers[0].updatedAt++
    }
    if (method !== 'servers.list') { catalog.preparation = { state: 'connecting' }; polling = 2 }
    else if (polling && --polling === 0) {
      catalog.preparation = { state: 'ready' }
      catalog.servers[0].check!.state = 'connected'
      catalog.servers[0].check!.checkedAt = Date.now()
      catalog.servers[0].check!.tools[0].disabled = catalog.servers[0].config.disabledTools?.includes('delete_entities') || false
    }
    return { ok: true, data: structuredClone(catalog) }
  })
  await page.addInitScript(() => {
    window.mossApp = {
      app: { getInfo: async () => ({ appearance: { themeMode: 'system', cssThemeId: 'default' } }), getStatus: async () => ({ state: 'running' }), getInstallationState: async () => ({ installation: { enabled: true } }) },
      actions: { invoke: async (name: string, input: unknown) => ({ ok: true, result: await (window as any).memoryInvoke(name, input) }), cancel: async () => {} },
      events: { on: () => () => {} },
    } as any
  })
  return { calls, catalog, graph, setGraphFailure: (value: boolean) => { graphFailure = value }, rejectNextReconnect: () => { rejectReconnect = true } }
}

test('shows memory settings and refreshes excluded tools', async ({ page }) => {
  const host = await fixture(page)
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('检查通过')
  await expect(page.getByRole('button', { name: '添加服务' })).toHaveCount(0)
  await expect(page.getByRole('switch')).toHaveCount(0)
  await page.getByRole('button', { name: '记忆设置' }).click()
  const dialog = page.getByRole('dialog', { name: '记忆设置' })
  await expect(dialog.getByLabel('记忆文件')).toHaveAttribute('readonly')
  await dialog.getByLabel('不启用的工具').fill('x'.repeat(129))
  await dialog.getByRole('button', { name: '保存并连接' }).click()
  await expect(dialog.getByRole('alert')).toContainText('有效的工具名称')
  await dialog.getByLabel('不启用的工具').fill('delete_entities')
  await dialog.getByRole('button', { name: '保存并连接' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('检查通过')
  expect(host.calls.filter(name => name === 'servers.save')).toHaveLength(1)
  await page.locator('.memory-tools summary').click()
  await expect(page.getByRole('heading', { name: 'delete_entities已排除' })).toBeVisible()
  expect(errors).toEqual([])
})

test('startup failure exposes configuration and retry while polling is bounded to preparation', async ({ page }) => {
  const host = await fixture(page, true)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('记忆文件无法写入')
  await expect(page.getByRole('button', { name: '记忆设置' })).toBeEnabled()
  host.rejectNextReconnect()
  await page.getByRole('button', { name: '重新连接' }).click()
  await expect(page.getByRole('alert')).toContainText('重连请求失败')
  await expect(page.getByRole('button', { name: '重新连接' })).toBeEnabled()
  await expect(page.getByRole('alert')).toContainText('重连请求失败')
  await page.getByRole('button', { name: '重新连接' }).click()
  await expect(page.getByRole('status')).toContainText('正在连接')
  await expect(page.getByRole('status')).toContainText('检查通过')
  expect(host.calls.filter(name => name === 'servers.inspect')).toHaveLength(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const theme of ['light', 'dark'] as const) test(`${theme} page and settings fit narrow windows`, async ({ page }) => {
  await fixture(page)
  await page.emulateMedia({ colorScheme: theme })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('检查通过')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await expect(page.locator('[data-engine="antv-g6"]')).toHaveAttribute('data-ready', 'true')
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: path.join(screenshots, `${theme}.png`), fullPage: true })
  await page.getByRole('button', { name: '记忆设置' }).click()
  await page.screenshot({ path: path.join(screenshots, `${theme}-settings.png`), fullPage: true })
  await page.keyboard.press('Escape')
  for (const width of [600, 390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '重新连接' })).toBeInViewport()
  }
  await page.screenshot({ path: path.join(screenshots, `${theme}-narrow.png`), fullPage: true })
})


test('browser demo is visible and never suggests real data was saved', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('演示模式', { exact: false })).toBeVisible()
  await expect(page.getByRole('heading', { name: '记忆', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '记忆设置' }).click()
  await expect(page.getByLabel('记忆文件')).toHaveValue(/演示数据/)
})

test('graph shows real facts, directed relations and linked node details', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  const graph = page.getByRole('region', { name: '记忆图谱', exact: true })
  await expect(graph).toContainText('共 3 条记忆 · 2 条关系')
  await expect(graph.locator('[data-engine="antv-g6"]')).toHaveAttribute('data-ready', 'true')
  await expect(graph.locator('[data-engine="antv-g6"]')).toHaveAttribute('data-edge-count', '2')
  await graph.getByRole('button', { name: '选中记忆：小林', exact: true }).focus()
  await page.keyboard.press('Enter')
  const details = page.getByRole('complementary', { name: '记忆详情' })
  await expect(details).toContainText('项目负责人')
  await expect(details).toContainText('<script>只是记忆文字</script>')
  await expect(details.locator('script')).toHaveCount(0)
  await details.getByRole('button', { name: '→ 负责 咖啡店网站' }).click()
  await expect(details.getByRole('heading', { name: '咖啡店网站', exact: true })).toBeVisible()
  await expect(details).toContainText('首页草图已完成')
  await graph.getByRole('button', { name: '列表', exact: true }).click()
  await graph.locator('.graph-list>button').filter({ hasText: '菜单页面' }).click()
  await expect(details).toContainText('展示饮品和价格')
})

test('search and type filters can be cleared, and graph refresh reflects external changes', async ({ page }) => {
  const host = await fixture(page)
  await page.goto('/')
  await page.getByRole('textbox', { name: '搜索记忆' }).fill('草图')
  await expect(page.getByRole('region', { name: '记忆图谱', exact: true })).toContainText('匹配 1 条')
  await expect(page.locator('[data-engine="antv-g6"]')).toHaveAttribute('data-node-count', '1')
  await page.getByRole('combobox', { name: '筛选记忆类型' }).selectOption('人物')
  await expect(page.getByText('没有匹配的记忆', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(page.locator('[data-engine="antv-g6"]')).toHaveAttribute('data-node-count', '3')
  host.graph.entities.push({ name: '晨光咖啡', entityType: '组织', observations: ['社区咖啡店'] })
  await page.getByRole('button', { name: '刷新记忆' }).click()
  await expect(page.getByRole('button', { name: '选中记忆：晨光咖啡' })).toBeAttached()
  host.setGraphFailure(true)
  await page.getByRole('button', { name: '刷新记忆' }).click()
  await expect(page.getByRole('alert')).toContainText('当前显示上次读取的内容')
  await expect(page.locator('[data-engine="antv-g6"]')).toHaveAttribute('data-node-count', '4')
  host.setGraphFailure(false)
  await page.getByRole('button', { name: '刷新记忆' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('empty installed memory has a useful first-use state without demo nodes', async ({ page }) => {
  const host = await fixture(page, false, true)
  await page.goto('/')
  await expect(page.getByText('第一段记忆，从一句话开始')).toBeVisible()
  await expect(page.locator('[data-engine="antv-g6"]')).toHaveCount(0)
  expect(host.calls).toContain('graph.read')
  expect(host.calls).not.toContain('servers.save')
})

test('graph supports keyboard selection, zoom and details on narrow screens', async ({ page }) => {
  await fixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('[data-engine="antv-g6"]')).toHaveAttribute('data-ready', 'true')
  const node = page.getByRole('button', { name: '选中记忆：小林', exact: true })
  await node.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: '记忆详情' })).toContainText('项目负责人')
  const before = await page.getByLabel('图谱缩放比例').textContent()
  await page.getByRole('button', { name: '放大图谱' }).click()
  await expect(page.getByLabel('图谱缩放比例')).not.toHaveText(before!)
  await page.getByRole('button', { name: '适应画布' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('G6 demo renders a complete graph and follows light and dark themes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  const canvas = page.locator('[data-engine="antv-g6"]')
  await expect(canvas).toHaveAttribute('data-ready', 'true')
  await expect(canvas).toHaveAttribute('data-node-count', '6')
  await expect(canvas).toHaveAttribute('data-edge-count', '5')
  await page.getByRole('button', { name: '选中记忆：咖啡店网站', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: '记忆图谱', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '记忆详情' })).toContainText('已完成首页草图')
  await mkdir(screenshots, { recursive: true })
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(canvas).toHaveAttribute('data-ready', 'true')
    await page.getByRole('region', { name: '记忆图谱', exact: true }).screenshot({ path: path.join(screenshots, `graph-demo-${theme}.png`) })
  }
  expect(errors).toEqual([])
})
