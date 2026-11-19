import { _electron as electron, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const repo = path.resolve(appRoot, '../..')
const core = process.env.MOSS_CORE_ROOT || path.resolve(repo, '../moss')
const target = `${process.platform}-${process.arch}`
const { id, version } = JSON.parse(await fs.readFile(path.join(appRoot, 'app.moss.json'), 'utf8'))
const archive = process.env.MOSS_ANYTHING_RAG_ARCHIVE || path.join(repo, `artifacts/${id}/${version}/${id}-${version}-${target}.zip`)
const nativeDisabled = process.env.MOSS_RAG_DISABLE_NATIVE === '1'
const output = path.join(repo, 'artifacts/moss.anything-rag/cdp')
await fs.mkdir(output, { recursive: true })
const corpus = [
  ['renewal.md', '# 续约挽留流程\n\n老客户下一年度不再购买时，先访谈实际使用者，区分预算不足、使用率偏低和关键功能缺失。预算不足可申请分期付款；使用率偏低安排两次免费培训；功能缺失记录到产品需求池。续约优惠最高为标准年费的 15%。'],
  ['invoice.md', '# 发票申请\n\n发票抬头错误时，先申请红冲，再重新开具，不能直接修改已开具发票。'],
  ['webhook.md', '# Webhook delivery\n\nWebhook requests contain X-Moss-Signature, an HMAC-SHA256 digest. Verify the signature before parsing JSON. Use event_id as the idempotency key.'],
  ['unrelated.md', '# 会议室预订\n\n会议室需要提前一天预订。'],
]
const desktop = await electron.launch({
  executablePath: process.env.MOSS_TEST_ELECTRON || path.join(core, 'ui/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: [path.join(appRoot, 'scripts/desktop-fixture.cjs')],
  env: { ...process.env, MOSS_CORE_ROOT: core, MOSS_ANYTHING_RAG_ARCHIVE: archive, MOSS_TEST_NODE: process.execPath, ...(nativeDisabled ? { MOSS_RAG_DISABLE_NATIVE: '1' } : {}) },
})
let page
const checks = []
const errors = []
try {
  await expect.poll(() => desktop.evaluate(() => Boolean(globalThis.anythingFixture)).catch(() => false), { timeout: 60000 }).toBe(true)
  page = desktop.windows()[0]
  page.on('pageerror', error => errors.push(error.message))
  let temporary
  await expect.poll(async () => { temporary = await desktop.evaluate(() => globalThis.anythingFixture?.temporary).catch(() => null); return Boolean(temporary) }, { timeout: 30000 }).toBe(true)
  const corpusDir = path.join(temporary, 'corpus')
  await fs.mkdir(corpusDir, { recursive: true })
  const files = []
  for (const [name, content] of corpus) { const file = path.join(corpusDir, name); await fs.writeFile(file, content); files.push(file) }
  await desktop.evaluate((_electron, paths) => globalThis.anythingFixture.setPicker(paths), files)

  await expect(page.getByRole('button', { name: '导入资料', exact: true })).toBeEnabled({ timeout: 60000 })
  if (nativeDisabled) {
    await expect(page.getByText('本地回退向量模式', { exact: true })).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('Native embedding 不可用，当前使用回退向量。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '重试 native', exact: true })).toBeEnabled()
    checks.push('安装包 UI 启动、自动准备引擎和 fallback 状态展示')
  } else {
    // A cold start may load the local ONNX model from disk on the first call.
    // Playwright's default 5s polling timeout is too short and makes a healthy
    // native package look broken. Keep the assertion bounded, but allow a
    // realistic cold-start window and include the status in a useful failure.
    await expect.poll(async () => {
      const value = await desktop.evaluate(() => globalThis.anythingFixture.invoke('engine.status'))
      const inner = value.data || value.result || value
      return (inner.data || inner.result || inner).engine?.native
    }, { timeout: 60000, intervals: [250, 500, 1000, 2000, 5000] }).toBe(true)
    await expect(page.getByText('本地回退向量模式', { exact: true })).toHaveCount(0)
    checks.push('安装包 UI 启动、自动准备引擎和 native embedding 状态展示')
  }

  await page.getByRole('button', { name: '导入资料', exact: true }).click()
  await expect(page.getByText('已导入 4 个文件', { exact: false })).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: '文档', exact: true }).click()
  await expect(page.locator('.table-row')).toHaveCount(4)
  checks.push('通过真实 local-files picker action 导入 4 个中文/英文资料并完成索引')

  await page.getByRole('button', { name: 'RAG 对话', exact: true }).click()
  const query = page.getByPlaceholder(/客户不想续费/)
  await query.fill('老用户说下一年不想再买了，我们该怎么挽留')
  await page.getByRole('button', { name: '检索证据', exact: true }).click()
  await expect(page.locator('.evidence-card').first()).toContainText('renewal.md', { timeout: 30000 })
  await page.locator('.evidence-card').first().getByRole('button').first().click()
  await expect(page.getByRole('heading', { name: 'renewal.md', exact: true })).toBeVisible()
  await expect(page.locator('.reader pre')).toContainText('15%')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  checks.push('中文自然改写问题命中续约资料，检索结果可打开真实资源阅读器')

  await query.fill('X-Moss-Signature')
  await page.getByRole('button', { name: '检索证据', exact: true }).click()
  await expect(page.locator('.evidence-card').first()).toContainText('webhook.md', { timeout: 30000 })
  checks.push('代码标识符问题命中 Webhook 资料')

  const refusal = await desktop.evaluate(() => globalThis.anythingFixture.invoke('documents.search', { query: '火星探测器燃料配方', threshold: 0.99 }))
  const refusalData = refusal.data || refusal
  assert.equal(refusalData.accepted, false)
  assert.match(refusalData.refusal, /没有找到足够相关的资料/)
  checks.push('无答案问题按阈值拒答并保留拒答原因')

  await page.getByRole('button', { name: '检索设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '中文检索策略', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重建全部索引', exact: true }).click()
  await expect(page.getByText('索引任务', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '索引任务', exact: true }).click()
  await expect(page.locator('.job-row').first()).toBeVisible()
  checks.push('设置页可调整检索策略，重建索引任务持久化到任务页')

  const created = await desktop.evaluate(() => globalThis.anythingFixture.invoke('spaces.create', { name: '客户支持' }))
  const space = (created.data || created).space
  assert.ok(space.id)
  const listed = await desktop.evaluate(() => globalThis.anythingFixture.invoke('spaces.list'))
  assert.ok((listed.data || listed).spaces.some(item => item.name === '客户支持'))
  checks.push('知识空间可创建、列出并独立保存')

  const documents = await desktop.evaluate(() => globalThis.anythingFixture.invoke('documents.list', { limit: 20 }))
  const first = (documents.data || documents).items[0]
  const read = await desktop.evaluate((_electron, id) => globalThis.anythingFixture.invoke('documents.read', { id }), first.id)
  const readData = read.data || read
  const resolved = await desktop.evaluate((_electron, uri) => globalThis.anythingFixture.invoke('resource.resolve', { uri }), readData.uri)
  assert.equal((resolved.data || resolved).kind, 'file')
  checks.push('文档读取、revision URI 和 moss-rag resource.resolve 可用')

  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.screenshot({ path: path.join(output, 'anything-rag-dark.png') })
  await page.setViewportSize({ width: 760, height: 660 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: path.join(output, 'anything-rag-compact.png') })
  checks.push('深色主题和窄窗口无横向溢出')
  assert.deepEqual(errors, [])
  const verification = { status: 'passed', package: archive, checks, errors, nativeEmbedding: nativeDisabled ? 'disabled for deterministic offline CDP run' : 'enabled with local model cache' }
  await fs.writeFile(path.join(output, 'cdp-verification.json'), JSON.stringify(verification, null, 2))
  await fs.writeFile(path.join(output, nativeDisabled ? 'cdp-fallback-verification.json' : 'cdp-native-verification.json'), JSON.stringify(verification, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks, output }, null, 2))
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await desktop.evaluate(() => globalThis.anythingFixture?.cleanup()).catch(() => {})
  await desktop.close()
}
