import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import engine from '../src/backend/engine.mjs'

test('offline uPlot: zoom, series, state sync, escaping, narrow and dark previews', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-uplot-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  const errors = [], requests = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('https://**/*', route => { requests.push(route.request().url()); return route.abort() })
  await page.addInitScript(() => {
    window.saved = null; window.saves = 0
    window.mossVisualization = { getState: () => null, setState: value => { window.saved = structuredClone(value); window.saves++ } }
  })
  for (const type of ['line', 'scatter']) {
    const directory = path.join(root, type); await fs.mkdir(directory)
    const csv = type === 'line' ? '月份,收入,成本\n一月,10,-5\n二月,2,0\n三月,20,8\n四月,9,4' : '时间,收入,成本\n10,10,-5\n2,2,0\n20,20,8\n9,9,4'
    const result = await engine.execute({ title: '<script>window.injected=1</script>', type, csv }, { directory, signal: new AbortController().signal, progress: async () => {} })
    await page.goto(pathToFileURL(result.artifacts[0].path).href)
    await page.locator('#interactive-chart[data-ready="true"] canvas').waitFor()
    assert.equal(await page.locator('#chart').isHidden(), true)
    assert.equal(await page.evaluate(() => window.injected), undefined)
    await page.locator('[data-toggle="1"]').uncheck()
    assert.deepEqual(await page.evaluate(() => window.saved.hiddenSeries), [1])
    await page.locator('#filter').fill(type === 'line' ? '二月' : '10')
    assert.equal(await page.locator('.table tbody tr:visible').count(), 1)
    const bounds = await page.locator('.u-over').boundingBox()
    await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .5)
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .5, { steps: 8 }); await page.mouse.up()
    await page.waitForFunction(() => Array.isArray(window.saved?.zoom))
    assert.equal(await page.locator('#reset-zoom').isEnabled(), true)
    await page.locator('#reset-zoom').click()
    assert.equal(await page.evaluate(() => window.saved.zoom), null)
    const saves = await page.evaluate(() => window.saves)
    await page.evaluate(() => dispatchEvent(new CustomEvent('moss:state', { detail: { filter: '', hiddenSeries: [], zoom: [2.5, 8] } })))
    await page.waitForTimeout(80)
    assert.equal(await page.evaluate(() => window.saves), saves, 'incoming state must not echo to the Host')
    assert.equal(await page.locator('.table tbody tr:visible').count(), 4)
    assert.equal(await page.locator('[data-toggle="1"]').isChecked(), true)
    for (const width of [1100, 480]) for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 800 }); await page.emulateMedia({ colorScheme })
      await page.waitForTimeout(80)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await fs.mkdir(new URL('../../../artifacts/preview-checks/', import.meta.url), { recursive: true })
      await page.screenshot({ path: new URL(`../../../artifacts/preview-checks/${type}-${width}-${colorScheme}.png`, import.meta.url).pathname })
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(requests, [])
})
