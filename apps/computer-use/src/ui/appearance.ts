import type { AppAppearance, AppUiApi } from '@moss/app-sdk'

// Embedded App documents do not inherit Moss's CSS or theme attributes.
export function syncAppearance(api: AppUiApi | undefined = window.mossApp) {
  const media = matchMedia('(prefers-color-scheme: dark)')
  let appearance: Partial<AppAppearance> = {}
  let disposed = false, revision = 0, pending = false, again = false
  const apply = () => {
    if (disposed) return
    const mode = appearance.themeMode
    const theme = mode === 'light' || mode === 'dark' ? mode : media.matches ? 'dark' : 'light'
    const background = String(appearance.cssThemeId || '')
    const root = document.documentElement
    root.dataset.theme = theme
    root.dataset.backgroundStyle = ['default', 'grid-theme', 'dot-theme', 'gradient-theme'].includes(background) ? background : 'grid-theme'
    root.style.colorScheme = theme
  }
  const refresh = async () => {
    if (disposed || !api) return
    if (pending) { again = true; return }
    pending = true
    const started = revision
    try {
      const info = await api.app.getInfo()
      // A live Host event takes precedence over an older getInfo response.
      if (!disposed && started === revision) { appearance = info.appearance || {}; apply() }
    } catch { /* Keep the last Host appearance during a transient disconnect. */ }
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
  apply()
  void refresh()
  window.addEventListener('focus', refresh)
  document.addEventListener('visibilitychange', visible)
  media.addEventListener('change', apply)
  return () => {
    disposed = true
    off?.()
    window.removeEventListener('focus', refresh)
    document.removeEventListener('visibilitychange', visible)
    media.removeEventListener('change', apply)
  }
}
