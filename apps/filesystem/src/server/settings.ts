import { directories, absolutePath } from './paths'
import { validateSettings, type Settings } from '../contracts'
export async function resolveSettings(raw: Settings): Promise<Settings> {
  const settings = validateSettings(raw)
  await directories(settings.directories)
  // Preserve explicitly configured aliases (e.g. /tmp on macOS). Upstream
  // registers both the supplied path and its canonical target.
  return { ...settings, directories: [...new Set(settings.directories.map(absolutePath))] }
}
