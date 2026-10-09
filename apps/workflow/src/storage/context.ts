import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync } from 'node:fs'
import path from 'node:path'

export type CatalogContext = { dataDir: string; cwd?: string }
const contexts = new AsyncLocalStorage<CatalogContext>()
export function withCatalogContext<T>(
  context: CatalogContext,
  action: () => T,
): T {
  return contexts.run(context, action)
}
export function getMossConfigHomeDir() {
  const context = contexts.getStore()
  if (!context) throw new Error('Catalog context is missing')
  return context.dataDir
}
export function getOriginalCwd() {
  return contexts.getStore()?.cwd ?? getMossConfigHomeDir()
}
export function findGitRoot(directory: string): string | undefined {
  let current = path.resolve(directory)
  while (true) {
    if (existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}
