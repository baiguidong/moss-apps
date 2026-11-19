import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const now = () => new Date().toISOString()

export class RagStore {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL, source_path TEXT NOT NULL, filename TEXT NOT NULL,
        mime TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', checksum TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1, pinned INTEGER NOT NULL DEFAULT 0, watched INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ready', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(space_id, source_path), FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', embedding TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS pdf_ocr (
        document_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, pages TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED, document_id UNINDEXED, title, content, source
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', error TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      );
    `)
  }
  close() { this.db.close() }
  ensureDefaultSpace() {
    const existing = this.db.prepare('SELECT id FROM spaces ORDER BY created_at LIMIT 1').get()
    if (existing) return existing.id
    const id = 'space-default'
    const time = now()
    this.db.prepare('INSERT INTO spaces(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(id, '默认知识空间', time, time)
    return id
  }
  listSpaces() { return this.db.prepare('SELECT id,name,created_at as createdAt,updated_at as updatedAt,(SELECT count(*) FROM documents d WHERE d.space_id=s.id) as documentCount FROM spaces s ORDER BY created_at').all() }
  createSpace(id, name) { const time = now(); this.db.prepare('INSERT INTO spaces(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(id, name, time, time); return this.db.prepare('SELECT * FROM spaces WHERE id=?').get(id) }
  updateSpace(id, name) { this.db.prepare('UPDATE spaces SET name=?,updated_at=? WHERE id=?').run(name, now(), id); return this.db.prepare('SELECT * FROM spaces WHERE id=?').get(id) }
  deleteSpace(id) { this.db.prepare('DELETE FROM spaces WHERE id=?').run(id) }
  getSpace(id) { return this.db.prepare('SELECT * FROM spaces WHERE id=?').get(id) }
  listDocuments({ spaceId, offset = 0, limit = 50 } = {}) {
    const query = spaceId ? 'SELECT id,space_id as spaceId,source_path as sourcePath,filename,mime,checksum,revision,pinned,watched,status,error,created_at as createdAt,updated_at as updatedAt FROM documents WHERE space_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?' : 'SELECT id,space_id as spaceId,source_path as sourcePath,filename,mime,checksum,revision,pinned,watched,status,error,created_at as createdAt,updated_at as updatedAt FROM documents ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    const args = spaceId ? [spaceId, limit, offset] : [limit, offset]
    const items = this.db.prepare(query).all(...args)
    const total = spaceId ? this.db.prepare('SELECT count(*) as count FROM documents WHERE space_id=?').get(spaceId).count : this.db.prepare('SELECT count(*) as count FROM documents').get().count
    return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null }
  }
  getDocument(id) { return this.db.prepare('SELECT id,space_id as spaceId,source_path as sourcePath,filename,mime,content,checksum,revision,pinned,watched,status,error,created_at as createdAt,updated_at as updatedAt FROM documents WHERE id=?').get(id) }
  getDocumentBySource(spaceId, sourcePath) { return this.db.prepare('SELECT * FROM documents WHERE space_id=? AND source_path=?').get(spaceId, sourcePath) }
  upsertDocument(doc) {
    const existing = this.getDocumentBySource(doc.spaceId, doc.sourcePath)
    const time = now()
    if (existing) {
      const revision = existing.revision + (existing.checksum === doc.checksum ? 0 : 1)
      this.db.prepare('UPDATE documents SET filename=?,mime=?,content=?,checksum=?,revision=?,status=?,error=?,updated_at=? WHERE id=?').run(doc.filename, doc.mime || '', doc.content, doc.checksum, revision, doc.status || 'ready', doc.error || null, time, existing.id)
      this.removeChunks(existing.id)
      return { ...existing, ...doc, id: existing.id, revision }
    }
    const id = doc.id || `doc-${crypto.randomUUID()}`
    this.db.prepare('INSERT INTO documents(id,space_id,source_path,filename,mime,content,checksum,revision,pinned,watched,status,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, doc.spaceId, doc.sourcePath, doc.filename, doc.mime || '', doc.content, doc.checksum, doc.revision || 1, doc.pinned ? 1 : 0, doc.watched ? 1 : 0, doc.status || 'ready', doc.error || null, time, time)
    return { ...doc, id, revision: doc.revision || 1 }
  }
  setDocumentStatus(id, status, error = null) { this.db.prepare('UPDATE documents SET status=?,error=?,updated_at=? WHERE id=?').run(status, error, now(), id) }
  getPdfOcr(id, checksum) {
    const row = this.db.prepare('SELECT pages FROM pdf_ocr WHERE document_id=? AND checksum=?').get(id, checksum)
    return row ? JSON.parse(row.pages) : null
  }
  savePdfOcr(id, checksum, pages) {
    this.db.prepare('INSERT INTO pdf_ocr(document_id,checksum,pages) VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET checksum=excluded.checksum,pages=excluded.pages').run(id, checksum, JSON.stringify(pages))
  }
  removeChunks(documentId) { const ids = this.db.prepare('SELECT id FROM chunks WHERE document_id=?').all(documentId).map(item => item.id); for (const id of ids) this.db.prepare('DELETE FROM chunks_fts WHERE chunk_id=?').run(id); this.db.prepare('DELETE FROM chunks WHERE document_id=?').run(documentId) }
  saveChunks(documentId, chunks) {
    const insert = this.db.prepare('INSERT INTO chunks(id,document_id,chunk_index,content,metadata,embedding) VALUES(?,?,?,?,?,?)')
    const fts = this.db.prepare('INSERT INTO chunks_fts(chunk_id,document_id,title,content,source) VALUES(?,?,?,?,?)')
    for (const chunk of chunks) { insert.run(chunk.id, documentId, chunk.index, chunk.content, JSON.stringify(chunk.metadata || {}), JSON.stringify(chunk.embedding || [])); fts.run(chunk.id, documentId, chunk.metadata?.title || '', chunk.content, chunk.metadata?.source || '') }
  }
  listChunks({ spaceId } = {}) {
    const query = spaceId ? 'SELECT c.id,c.document_id as documentId,c.chunk_index as chunkIndex,c.content,c.metadata,c.embedding,d.filename,d.source_path as sourcePath,d.revision,d.space_id as spaceId FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.space_id=?' : 'SELECT c.id,c.document_id as documentId,c.chunk_index as chunkIndex,c.content,c.metadata,c.embedding,d.filename,d.source_path as sourcePath,d.revision,d.space_id as spaceId FROM chunks c JOIN documents d ON d.id=c.document_id'
    return (spaceId ? this.db.prepare(query).all(spaceId) : this.db.prepare(query).all()).map(row => ({ ...row, metadata: JSON.parse(row.metadata || '{}'), embedding: JSON.parse(row.embedding || '[]') }))
  }
  searchFts(query, spaceId) {
    try {
      const sql = spaceId ? 'SELECT f.chunk_id as chunkId,bm25(chunks_fts) as rank FROM chunks_fts f JOIN chunks c ON c.id=f.chunk_id JOIN documents d ON d.id=c.document_id WHERE chunks_fts MATCH ? AND d.space_id=? LIMIT 200' : 'SELECT chunk_id as chunkId,bm25(chunks_fts) as rank FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 200'
      const q = query.trim().split(/\s+/).filter(Boolean).map(token => `"${token.replaceAll('"', '')}"`).join(' OR ')
      return spaceId ? this.db.prepare(sql).all(q, spaceId) : this.db.prepare(sql).all(q)
    } catch { return [] }
  }
  deleteDocument(id) {
    const document = this.getDocument(id)
    if (!document) return null
    this.removeChunks(id)
    this.db.prepare('DELETE FROM documents WHERE id=?').run(id)
    return document
  }
  createJob(id, kind, total) { const time = now(); this.db.prepare('INSERT INTO jobs(id,kind,status,total,completed,message,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, kind, 'running', total, 0, '', null, time, time); return id }
  recoverInterruptedJobs() {
    const result = this.db.prepare("UPDATE jobs SET status='cancelled',message='应用上次退出，任务已中断',updated_at=? WHERE status='running'").run(now())
    this.db.prepare("UPDATE documents SET status='error',error='上次索引任务被中断',updated_at=? WHERE status='indexing'").run(now())
    return result.changes
  }
  updateJob(id, patch) { const current = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); if (!current) return; this.db.prepare('UPDATE jobs SET status=?,total=?,completed=?,message=?,error=?,updated_at=? WHERE id=?').run(patch.status ?? current.status, patch.total ?? current.total, patch.completed ?? current.completed, patch.message ?? current.message, patch.error ?? current.error, now(), id) }
  listJobs() { return this.db.prepare('SELECT id,kind,status,total,completed,message,error,created_at as createdAt,updated_at as updatedAt FROM jobs ORDER BY created_at DESC LIMIT 100').all() }
  getSetting(key, fallback = null) { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); if (!row) return fallback; try { return JSON.parse(row.value) } catch { return row.value } }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)) }
}
