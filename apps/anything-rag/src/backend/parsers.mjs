import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { parsePdfWithPython } from './pdf-python.mjs'

const require = createRequire(import.meta.url)

export class PdfNoTextError extends Error {
  constructor() { super('PDF 中未找到可读文本；扫描 PDF 需要 OCR。') }
}

export const SUPPORTED_EXTENSIONS = new Set(['.txt','.md','.org','.adoc','.rst','.csv','.json','.html','.htm','.pdf','.docx','.pptx','.xlsx','.py','.js','.ts','.tsx','.jsx','.go','.rs','.java','.kt','.c','.cpp','.h','.hpp','.yaml','.yml','.xml','.sql','.sh','.toml'])
const mimeByExt = { '.md':'text/markdown','.txt':'text/plain','.csv':'text/csv','.json':'application/json','.html':'text/html','.htm':'text/html','.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
export function mimeFor(file) { return mimeByExt[path.extname(file).toLowerCase()] || 'text/plain' }
function stripHtml(value) { return value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim() }
function stripXml(value) { return value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/\s+/g, ' ').trim() }
async function parseOffice(buffer, ext) {
  const { unzipSync, strFromU8 } = await import('fflate')
  const files = unzipSync(new Uint8Array(buffer)), names = Object.keys(files)
  const wanted = ext === '.docx' ? names.filter(name => name === 'word/document.xml' || name.startsWith('word/header') || name.startsWith('word/footer')) : ext === '.pptx' ? names.filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml')) : names.filter(name => name === 'xl/sharedStrings.xml' || name.startsWith('xl/worksheets/sheet'))
  const text = wanted.sort().map(name => stripXml(strFromU8(files[name]))).filter(Boolean).join('\n\n')
  if (!text) throw new Error(`${ext.slice(1).toUpperCase()} 中未找到可读文本`)
  return text
}
function abortError(signal) { return signal?.reason instanceof Error ? signal.reason : Object.assign(new Error('操作已取消'), { name: 'AbortError' }) }
function throwIfAborted(signal) { if (signal?.aborted) throw abortError(signal) }
async function abortable(promise, signal) {
  throwIfAborted(signal)
  if (!signal) return promise
  let onAbort
  try {
    return await Promise.race([promise, new Promise((_, reject) => { onAbort = () => reject(abortError(signal)); signal.addEventListener('abort', onAbort, { once: true }) })])
  } finally { if (onAbort) signal.removeEventListener('abort', onAbort) }
}
function validPdfText(value) {
  const text = String(value || '').replace(/\u0000/g, '').trim()
  if (!text) return ''
  // Never index PDF object dictionaries or xref streams as if they were body text.
  if (/(?:^|\n)\s*\d+\s+\d+\s+obj\b|\bendobj\b|\bxref\b|\/Type\s*\/Page(?:s)?\b|\bstream\b[\s\S]*\bendstream\b/i.test(text)) return ''
  return text
}
async function parsePdfWithPdfJs(buffer, signal) {
  throwIfAborted(signal)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'))
  const pdf = await abortable(getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: `${packageRoot}/standard_fonts/`, cMapUrl: `${packageRoot}/cmaps/`, cMapPacked: true }).promise, signal)
  const pages = []
  try {
    for (let index = 1; index <= pdf.numPages; index++) {
      throwIfAborted(signal)
      const page = await abortable(pdf.getPage(index), signal)
      try {
        const content = await abortable(page.getTextContent(), signal)
        pages.push(content.items.map(item => item.str ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('').replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, '$1').trim())
      } finally { page.cleanup() }
    }
  } finally { await pdf.destroy() }
  return validPdfText(pages.filter(Boolean).join('\n\n'))
}
async function parsePdf(buffer, { file, signal, python }) {
  throwIfAborted(signal)
  try {
    const module = await import('pdf-parse'); const parse = module.default || module
    const result = await abortable(parse(buffer), signal); const text = validPdfText(result.text)
    if (text) return text
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error }
  try {
    const text = await parsePdfWithPdfJs(buffer, signal)
    if (text) return text
  } catch (error) { if (error?.name === 'AbortError' || signal?.aborted) throw error }
  if (python?.resolve) {
    const runtime = await python.resolve(signal)
    const result = await parsePdfWithPython({ file, parserPath: runtime.parserPath, pythonPath: runtime.pythonPath, modulePath: runtime.modulePath, signal })
    const text = validPdfText(result.text)
    if (text) return text
  }
  throw new PdfNoTextError()
}
export async function parseFile(file, { signal, python } = {}) {
  throwIfAborted(signal)
  const ext = path.extname(file).toLowerCase(), buffer = await abortable(fs.readFile(file), signal)
  if (ext === '.json') { try { return JSON.stringify(JSON.parse(buffer.toString('utf8')), null, 2) } catch { return buffer.toString('utf8') } }
  if (ext === '.html' || ext === '.htm') return stripHtml(buffer.toString('utf8'))
  if (ext === '.pdf') return parsePdf(buffer, { file, signal, python })
  if (ext === '.docx' || ext === '.pptx' || ext === '.xlsx') return parseOffice(buffer, ext)
  return buffer.toString('utf8').replace(/^\uFEFF/, '')
}
export function splitText(text, { chunkSize = 1000, overlap = 200, title = '', source = '' } = {}) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
  if (!normalized) return []
  const chunks = [], paragraphs = normalized.split(/\n{2,}/).map(item => item.trim()).filter(Boolean)
  let current = ''
  const flush = () => { if (!current) return; chunks.push(current); current = current.slice(Math.max(0, current.length - overlap)) }
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > chunkSize) flush()
    if (paragraph.length <= chunkSize) current += (current ? '\n\n' : '') + paragraph
    else { for (let start = 0; start < paragraph.length; start += Math.max(1, chunkSize - overlap)) { const part = paragraph.slice(start, start + chunkSize); if (part.trim()) chunks.push(part.trim()); if (start + chunkSize >= paragraph.length) break } current = '' }
  }
  flush()
  return chunks.map((content, index) => ({ index, content, metadata: { title, source, chunkIndex: index } }))
}
