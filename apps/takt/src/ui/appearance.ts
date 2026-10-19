import { useSyncExternalStore } from 'react'
import type { AppAppearance, AppUiApi } from '@moss/app-sdk'

const backgrounds = new Set(['default', 'grid-theme', 'dot-theme', 'gradient-theme', 'takt-theme'])
const subscribers = new Set<() => void>()
const subscribe = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener) } }
const colorMode = (): 'light' | 'dark' => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
export const useColorMode = () => useSyncExternalStore(subscribe, colorMode)

// App windows and conversation guests share the Host's persisted appearance.
export function syncAppearance(api: AppUiApi | undefined = window.mossApp) {
  const media = matchMedia('(prefers-color-scheme: dark)')
  let appearance: Partial<AppAppearance> = { themeMode: 'light', cssThemeId: 'grid-theme' }
  let disposed = false, revision = 0, pending = false, again = false
  const apply = () => {
    if (disposed) return
    const mode = appearance.themeMode
    const theme = mode === 'light' || mode === 'dark' ? mode : media.matches ? 'dark' : 'light'
    const background = String(appearance.cssThemeId || '')
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.backgroundStyle = backgrounds.has(background) ? background : 'grid-theme'
    root.style.colorScheme = theme
    for (const listener of subscribers) listener()
  }
  const refresh = async () => {
    if (disposed || !api) return
    if (pending) { again = true; return }
    pending = true
    const started = revision
    try {
      const info = await api.app.getInfo()
      // A settings notification must not be overwritten by an older read.
      if (!disposed && started === revision) { appearance = info.appearance || appearance; apply() }
    } catch { /* Keep the last appearance while reconnecting. */ }
    finally {
      pending = false
      if (again && !disposed) { again = false; void refresh() }
    }
  }
  const off = api?.events.on('appearance', (value: unknown) => {
    if (disposed || !value || typeof value !== 'object') return
    revision++
    appearance = value as Partial<AppAppearance>
    apply()
  })
  const visible = () => { if (!document.hidden) void refresh() }
  apply(); void refresh()
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', visible)
  media.addEventListener('change', apply)
  return () => {
    disposed = true; off?.()
    window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', visible)
    media.removeEventListener('change', apply)
  }
}
