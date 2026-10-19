import assert from 'node:assert/strict'

// Accept a Playwright Page or Frame. Check rendered text so sr-only headings,
// document titles and accessible main labels remain available to assistive tech.
// Run on initial/empty UI, before opening documents with user-controlled titles.
export async function assertAppContentLayout(page, { displayName, description }) {
  const duplicates = await page.evaluate(identity => {
    const normalize = value => value?.replace(/\s+/g, ' ').trim()
    const labels = new Set(identity.filter(Boolean).map(normalize))
    return [...document.body.querySelectorAll('*')].filter(element => {
      if (['SCRIPT', 'STYLE', 'TITLE'].includes(element.tagName)) return false
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
      if (rect.width <= 1 || rect.height <= 1 || style.visibility !== 'visible' || style.display === 'none' || style.opacity === '0') return false
      if (!labels.has(normalize(element.innerText))) return false
      return ![...element.children].some(child => normalize(child.innerText) === normalize(element.innerText))
    }).map(element => element.innerText.trim())
  }, [displayName, description])
  assert.deepEqual(duplicates, [], 'The embedded page repeats the App identity supplied by Moss')
}

// Mark the real input/list/editor/result area. This checks geometry, not a style
// score; visual review is still necessary. Call at scroll position zero.
export async function assertAppWorkspaceLayout(page, { primary = '[data-app-primary]', toolbar = '[data-app-toolbar]', secondaryActions = '[data-app-secondary-action]', maxPrimaryTop = 96 } = {}) {
  const result = await page.evaluate(({ primary, toolbar, secondaryActions }) => {
    const visible = element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
      return rect.width > 1 && rect.height > 1 && style.visibility === 'visible' && style.display !== 'none' && style.opacity !== '0'
    }
    const content = [...document.querySelectorAll(primary)].find(visible)
    const rect = content?.getBoundingClientRect()
    const orphanToolbars = [...document.querySelectorAll(toolbar)].filter(visible).filter(element => {
      const secondary = [...element.querySelectorAll(secondaryActions)].filter(visible)
      if (!secondary.length) return false
      // A legitimate title, label, input or primary action supplies context.
      const isSecondary = child => secondary.some(action => action === child || action.contains(child))
      if ([...element.querySelectorAll('input,select,textarea,button,[role="button"]')].some(child => visible(child) && !isSecondary(child))) return false
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent.trim() && visible(node.parentElement) && !isSecondary(node.parentElement)) return false
      }
      return true
    }).map(element => element.textContent.trim())
    return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      primary: rect ? { top: rect.top, left: rect.left, right: rect.right, width: rect.width } : null, orphanToolbars }
  }, { primary, toolbar, secondaryActions })
  assert.equal(result.overflow, false, 'The App overflows the viewport horizontally; scroll large data inside its own region')
  assert.ok(result.primary, 'Mark the actual primary content region for workspace verification')
  assert.ok(result.primary.top >= -1 && result.primary.top <= maxPrimaryTop, `Primary content starts at ${result.primary.top}px; move secondary chrome out of the way`)
  assert.ok(result.primary.left >= -1 && result.primary.right <= result.width + 1, 'Primary content must fit in the viewport')
  assert.deepEqual(result.orphanToolbars, [], 'Secondary settings/help actions must share a content heading or business toolbar')
}
