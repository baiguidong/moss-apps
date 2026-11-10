import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { fixture } from '@moss/creation-apps/testing'
import engine from '../src/backend/engine.mjs'

test('offline TanStack preview: numeric sorting, filter, pagination, columns, per-sheet state and escaping', async t => {
  const f = await fixture(t, engine)
  const rows = [['项目', '金额', '条件'], ['十', { value: 10, numFmt: '0.00' }, false], ['二', { value: 2, numFmt: '0.00' }, true], ['负数', -3, false], ['</script><img src=x onerror="window.injected=1">', 0, false], ...Array.from({ length: 61 }, (_, i) => ['项目' + i, 100 + i, true])]
  const task = await f.run({ title: '预算预览', sheets: [{ name: '预算', rows }, { name: '无表头', header: false, rows: [['第一行', 8], ['第二行', 9]] }, { name: '空表', rows: [] }] })
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } }), errors = [], requests = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://**/*', route => { requests.push(route.request().url()); return route.abort() })
  await page.addInitScript(() => {
    window.saved = null
    window.mossVisualization = { getState: () => null, setState: value => { window.saved = structuredClone(value) } }
  })
  await page.goto(pathToFileURL(task.artifacts[1].path).href)
  await page.locator('#interactive-table:visible table').waitFor()
  assert.equal(await page.locator('#interactive-table tbody tr').count(), 25)
  await page.getByRole('button', { name: '按金额排序' }).click()
  assert.match(await page.locator('#interactive-table tbody tr').first().textContent(), /负数.*-3/)
  assert.match(await page.locator('#interactive-table tbody tr').nth(2).textContent(), /二.*2\.00/)
  await page.locator('#next').click()
  assert.match(await page.locator('#page-status').textContent(), /第 2 \/ 3 页/)
  await page.locator('#search').fill('10.00')
  assert.equal(await page.locator('#interactive-table tbody tr').count(), 1)
  assert.match(await page.locator('#interactive-table tbody').textContent(), /十/)
  await page.locator('#search').fill('')
  await page.locator('#columns summary').click()
  await page.locator('#column-options input[value="c2"]').uncheck()
  assert.equal(await page.locator('#interactive-table thead th').count(), 3)
  const saved = await page.evaluate(() => window.saved)
  await page.selectOption('#sheet', '1')
  assert.match(await page.locator('#interactive-table tbody tr').first().textContent(), /第一行/)
  assert.match(await page.locator('#interactive-table thead').textContent(), /A.*B/)
  await page.selectOption('#sheet', '0')
  assert.equal(await page.locator('#column-options input[value="c2"]').isChecked(), false)
  assert.match(await page.locator('#interactive-table tbody tr').first().textContent(), /负数/)
  await page.locator('#reset-view').click()
  await page.evaluate(state => dispatchEvent(new CustomEvent('moss:state', { detail: state })), saved)
  assert.equal(await page.locator('#column-options input[value="c2"]').isChecked(), false)
  assert.equal(await page.evaluate(() => window.injected), undefined)
  assert.equal(await page.locator('img').count(), 0)
  for (const width of [1100, 480]) for (const colorScheme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 800 }); await page.emulateMedia({ colorScheme })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await fs.mkdir(new URL('../../../artifacts/preview-checks/', import.meta.url), { recursive: true })
    await page.screenshot({ path: new URL(`../../../artifacts/preview-checks/table-${width}-${colorScheme}.png`, import.meta.url).pathname })
  }
  await page.selectOption('#sheet', '2')
  assert.match(await page.locator('#interactive-table').textContent(), /没有匹配的数据/)
  assert.equal(await page.locator('#next').isDisabled(), true)
  await page.evaluate(() => dispatchEvent(new CustomEvent('moss:state', { detail: { sheet: 0, tableViews: { 0: { sorting: [{ id: 'unknown' }], pagination: { pageIndex: -5, pageSize: 999 }, columnVisibility: { c0: false, c1: false, c2: false } } } } })))
  assert.equal(await page.locator('#interactive-table thead th').count(), 2)
  assert.match(await page.locator('#page-status').textContent(), /第 1 \/ 3 页/)
  assert.deepEqual(errors, []); assert.deepEqual(requests, [])
})
