export type Kind = 'postgres' | 'mysql' | 'mariadb' | 'sqlite' | 'dsn'
export type Settings = { title: string; kind: Kind; host: string; port: number; database: string; username: string; file: string; readonly: boolean; maxRows: number; timeout: number }
export type Connection = Settings & { id: string; enabled: boolean; legacy: boolean; status: string; error: string; tools: { name: string; description: string }[] }
export type Catalog = { connections: Connection[]; savedId?: string }
export const defaults: Settings = { title: '', kind: 'postgres', host: 'localhost', port: 5432, database: '', username: '', file: '', readonly: true, maxRows: 1000, timeout: 10 }
export const kinds: Record<Kind, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', sqlite: 'SQLite', dsn: '自定义连接地址' }
