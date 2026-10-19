import { createAppClient } from '@moss/app-sdk/ui'
// Pair with index.html, ui.css and theme.css. Keep optional settings in the
// existing toolbar and give available width/height to the real inputs/results.
const client = window.mossApp ? createAppClient(window.mossApp) : null
const media = matchMedia('(prefers-color-scheme: dark)')
let appearance = { themeMode: 'system', cssThemeId: 'default' }, disposed = false, revision = 0
const applyAppearance = () => {
  const mode = appearance.themeMode
  const theme = mode === 'dark' || mode === 'light' ? mode : media.matches ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.backgroundStyle = appearance.cssThemeId || 'default'
  document.documentElement.style.colorScheme = theme
}
const refreshAppearance = async () => {
  const current = ++revision
  try {
    const info = await client?.app.getInfo()
    if (disposed || current !== revision) return
    if (info?.appearance) appearance = info.appearance
    applyAppearance()
  } catch { /* Keep the last theme; appearance errors must not disable the workspace. */ }
}
applyAppearance(); void refreshAppearance()
media.addEventListener('change', applyAppearance)
client?.events.on('appearance', refreshAppearance)
const settings = document.querySelector('#settings')
document.querySelector('#open-settings').addEventListener('click', () => settings.showModal())
document.querySelector('#close-settings').addEventListener('click', () => settings.close())
// Call only target App Actions declared by its own manifest:
// const result = await client.actions.invoke('example', { value: 'hello' })
window.addEventListener('pagehide', () => { disposed = true; media.removeEventListener('change', applyAppearance); client?.dispose() }, { once: true })
