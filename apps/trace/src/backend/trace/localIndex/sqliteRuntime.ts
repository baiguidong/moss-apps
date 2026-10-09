import { createRequire } from 'node:module'

// Keep Bun's native module out of Node/Electron bundles. The adapter exposes
// the small synchronous interface used by the upstream trace migrations.
const runtimeRequire = createRequire(import.meta.url)
type Binding = bigint | boolean | number | string | null | Uint8Array
type NativeStatement = {
  get(...bindings: unknown[]): unknown
  all(...bindings: unknown[]): unknown[]
  run(...bindings: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  finalize?(): void
}
type NativeDatabase = {
  prepare(sql: string): NativeStatement
  exec(sql: string): void
  close(): void
}

function sqliteOperation<T>(operation: () => T): T {
  try { return operation() }
  catch (error) {
    // node:sqlite uses ERR_SQLITE_ERROR plus a numeric errcode; preserve the
    // upstream index's recoverable SQLITE_BUSY/LOCKED cooldown behavior.
    if (error && typeof error === 'object' && 'errcode' in error) {
      const primaryCode = Number(error.errcode) & 0xff
      if (primaryCode === 5 || primaryCode === 6) {
        Object.assign(error, { code: primaryCode === 5 ? 'SQLITE_BUSY' : 'SQLITE_LOCKED' })
      }
    }
    throw error
  }
}

export class Database {
  private readonly native: NativeDatabase
  private readonly statements = new Set<NativeStatement>()

  constructor(path: string) {
    if (process.versions.bun) {
      const moduleName = 'bun:sqlite'
      this.native = sqliteOperation(() => new (runtimeRequire(moduleName).Database)(path))
    } else {
      const moduleName = 'node:sqlite'
      this.native = sqliteOperation(() => new (runtimeRequire(moduleName).DatabaseSync)(path))
    }
  }

  prepare<T = unknown, B extends Binding[] = Binding[]>(sql: string) {
    const statement = sqliteOperation(() => this.native.prepare(sql))
    this.statements.add(statement)
    const normalize = (bindings: B) => bindings.map(value => typeof value === 'boolean' ? Number(value) : value)
    return {
      get: (...bindings: B): T | null => (sqliteOperation(() => statement.get(...normalize(bindings))) as T | undefined) ?? null,
      all: (...bindings: B): T[] => sqliteOperation(() => statement.all(...normalize(bindings))) as T[],
      run: (...bindings: B) => {
        const result = sqliteOperation(() => statement.run(...normalize(bindings)))
        return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid }
      },
      finalize: () => { statement.finalize?.(); this.statements.delete(statement) },
    }
  }

  query(sql: string) { return this.prepare(sql) }
  exec(sql: string) { sqliteOperation(() => this.native.exec(sql)) }
  clearQueryCache() {
    for (const statement of this.statements) statement.finalize?.()
    this.statements.clear()
  }
  close(_throwOnError?: boolean) { this.native.close() }

  transaction<T>(operation: () => T): () => T {
    return () => {
      this.exec('BEGIN IMMEDIATE')
      try {
        const result = operation()
        this.exec('COMMIT')
        return result
      } catch (error) {
        try { this.exec('ROLLBACK') } catch { /* Preserve the original error. */ }
        throw error
      }
    }
  }
}
