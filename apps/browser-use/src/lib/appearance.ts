export function syncAppearance() {
  const media = matchMedia('(prefers-color-scheme: dark)')
  let mode = 'system', background = 'grid-theme', disposed = false, pending = false, again = false
  const apply = () => {
    if (disposed) return
    const theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode
    const root = document.documentElement
    if (root.dataset.theme !== theme) root.dataset.theme = theme
    if (root.dataset.backgroundStyle !== background) root.dataset.backgroundStyle = background
    root.style.colorScheme = theme
  }
  const refreshAppearance = async () => {
    if (disposed) return
    if (pending) { again = true; return }
    pending = true
    try {
      const info = await window.mossApp?.app.getInfo()
      const value = info?.appearance as { themeMode?: string; cssThemeId?: string } | undefined
      mode = ['light', 'dark', 'system'].includes(value?.themeMode || '') ? value!.themeMode! : 'system'
      background = ['default', 'grid-theme', 'dot-theme', 'gradient-theme'].includes(value?.cssThemeId || '') ? value!.cssThemeId! : 'grid-theme'
    } catch { mode = 'system'; background = 'grid-theme' }
    finally {
      pending = false; apply()
      if (again && !disposed) { again = false; void refreshAppearance() }
    }
  }
  const visible = () => { if (document.visibilityState === 'visible') void refreshAppearance() }
  const systemChanged = () => { if (mode === 'system') apply() }
  apply(); void refreshAppearance()
  window.addEventListener('focus', refreshAppearance)
  document.addEventListener('visibilitychange', visible)
  media.addEventListener('change', systemChanged)
  return () => {
    disposed = true
    window.removeEventListener('focus', refreshAppearance)
    document.removeEventListener('visibilitychange', visible)
    media.removeEventListener('change', systemChanged)
  }
}
