import { realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
export function absolutePath(value: string): string {
  const expanded = value === '~' ? homedir() : /^~[\\/]/.test(value) ? path.join(homedir(), value.slice(2)) : value
  if (!path.isAbsolute(expanded)) throw new Error('请使用绝对路径或 ~/ 开头的目录路径。')
  return path.normalize(expanded)
}
export async function directories(values: string[]): Promise<string[]> {
  const result = []
  for (const value of values) {
    const expanded = absolutePath(value)
    let canonical: string
    try {
      canonical = await realpath(expanded)
      if (!(await stat(canonical)).isDirectory()) throw new Error('not a directory')
    } catch { throw new Error(`目录不存在或不可访问：${value}`) }
    result.push(canonical)
  }
  return [...new Set(result)]
}
export function within(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}
