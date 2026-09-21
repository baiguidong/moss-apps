import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

function getSettingsPath(): string {
  const configDir = process.env.MOSS_CONFIG_DIR || path.join(os.homedir(), '.moss')
  return path.join(configDir, 'settings.json')
}

function readSettingsFile(strict = false): Record<string, any> {
  try {
    const parsed = JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error: any) {
    if (strict && error?.code !== 'ENOENT') throw error
    return {}
  }
}

export function readAdapterConfig(): Record<string, any> {
  const settings = readSettingsFile()
  const adapters = settings.adapters
  return adapters && typeof adapters === 'object' && !Array.isArray(adapters)
    ? adapters
    : {}
}

export function writeAdapterConfig(config: Record<string, any>): void {
  const filePath = getSettingsPath()
  const settings = readSettingsFile(true)
  settings.adapters = config
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, filePath)
}
