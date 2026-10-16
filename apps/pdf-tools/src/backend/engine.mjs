import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PDFDocument, degrees } from 'pdf-lib'

const require = createRequire(import.meta.url)
async function load(file) {
  const bytes = await fs.readFile(file)
  if (bytes.length > 250 * 1024 ** 2) throw new Error('PDF 首版支持单文件不超过 250 MiB')
  const document = await PDFDocument.load(bytes)
  if (document.getPageCount() > 500) throw new Error('PDF 首版支持单文件不超过 500 页')
  return document
}
export async function inspect(file) {
  if (path.extname(file).toLowerCase() !== '.pdf') throw new Error('请选择 PDF 文件')
  const document = await load(file)
  return { kind: 'pdf', metadata: { pages: document.getPageCount() } }
}
export function validate(input, files) {
  if (!Array.isArray(input.fileIds) || !input.fileIds.length || input.fileIds.length > 50) throw new Error('请选择 PDF 文件')
  const fileIds = [...new Set(input.fileIds)], selected = fileIds.map(id => { const file = files.find(f => f.id === id && f.kind === 'pdf'); if (!file) throw new Error('选择的 PDF 不存在'); return file })
  const options = input.options || {}, mode = options.mode || 'arrange'
  if (!['arrange', 'split', 'ocr'].includes(mode)) throw new Error('不支持的 PDF 操作')
  const pages = options.pages || selected.flatMap(file => Array.from({ length: file.metadata.pages }, (_, page) => ({ fileId: file.id, page, rotation: 0 })))
  if (!Array.isArray(pages) || !pages.length || pages.length > (mode === 'ocr' ? 80 : 500)) throw new Error(mode === 'ocr' ? '每次 OCR 请选择 1–80 页' : '请选择 1–500 页')
  for (const item of pages) {
    const file = selected.find(f => f.id === item.fileId)
    if (!file || !Number.isInteger(item.page) || item.page < 0 || item.page >= file.metadata.pages || ![0, 90, 180, 270].includes(item.rotation || 0)) throw new Error('页面或旋转角度无效')
  }
  const language = options.language || 'chi_sim+eng'
  if (!['eng', 'chi_sim', 'chi_sim+eng'].includes(language)) throw new Error('请选择中文、英文或中英混合')
  return { fileIds, title: `${mode === 'ocr' ? 'OCR 识别' : mode === 'split' ? '拆分' : '整理'} ${pages.length} 页 PDF`, options: { mode, pages: pages.map(p => ({ fileId: p.fileId, page: p.page, rotation: p.rotation || 0 })), language } }
}
export async function execute({ input, files, outputDir, signal, progress }) {
  const { mode, pages, language } = input.options, documents = new Map(), outputs = []
  for (const id of input.fileIds) documents.set(id, await load(files.find(f => f.id === id).path))
  const combined = await PDFDocument.create()
  for (const item of pages) {
    signal.throwIfAborted()
    const [page] = await combined.copyPages(documents.get(item.fileId), [item.page])
    page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360)); combined.addPage(page)
  }
  if (mode === 'split') {
    for (let index = 0; index < pages.length; index++) {
      signal.throwIfAborted(); progress(index / pages.length * 100, `拆分第 ${index + 1} 页`)
      const single = await PDFDocument.create(), [page] = await single.copyPages(combined, [index]); single.addPage(page)
      const name = `第${String(index + 1).padStart(3, '0')}页.pdf`, file = path.join(outputDir, name)
      await fs.writeFile(file, await single.save()); outputs.push({ name, path: file, kind: 'pdf', metadata: { pages: 1 } })
    }
  } else if (mode === 'ocr') {
    progress(0, '准备本地文字识别')
    const { createCanvas, DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas')
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { createWorker } = await import('tesseract.js')
    const langPath = path.join(outputDir, '.ocr-languages'); await fs.mkdir(langPath, { recursive: true })
    for (const code of language.split('+')) await fs.copyFile(path.join(path.dirname(require.resolve(`@tesseract.js-data/${code}`)), '4.0.0_best_int', `${code}.traineddata.gz`), path.join(langPath, `${code}.traineddata.gz`))
    let current = 0
    const worker = await createWorker(language, 1, { langPath, cacheMethod: 'none', logger: message => { if (message.status === 'recognizing text') progress((current + message.progress) / pages.length * 100, `识别第 ${current + 1}/${pages.length} 页`) } })
    const abort = () => { void worker.terminate() }; signal.addEventListener('abort', abort, { once: true })
    const pdf = await getDocument({ data: await combined.save(), useSystemFonts: false, standardFontDataUrl: `${path.dirname(require.resolve('pdfjs-dist/package.json'))}/standard_fonts/`, cMapUrl: `${path.dirname(require.resolve('pdfjs-dist/package.json'))}/cmaps/`, cMapPacked: true, isEvalSupported: false }).promise
    const searchable = await PDFDocument.create(), textPages = []
    try {
      await worker.setParameters({ user_defined_dpi: '144' })
      for (current = 0; current < pages.length; current++) {
        signal.throwIfAborted()
        const page = await pdf.getPage(current + 1), viewport = page.getViewport({ scale: 2 })
        if (viewport.width * viewport.height > 30_000_000) throw new Error('页面过大，无法安全生成 OCR 图像')
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        const { data } = await worker.recognize(canvas.toBuffer('image/png'), { pdfTitle: 'Moss OCR', pdfTextOnly: false }, { pdf: true, text: true })
        signal.throwIfAborted()
        const recognized = await PDFDocument.load(Uint8Array.from(data.pdf)), copied = await searchable.copyPages(recognized, recognized.getPageIndices())
        copied.forEach(p => searchable.addPage(p)); textPages.push({ page: current + 1, text: data.text })
        page.cleanup()
      }
      const pdfPath = path.join(outputDir, '可搜索文档.pdf'), textPath = path.join(outputDir, '识别文字.txt'), jsonPath = path.join(outputDir, '识别文字.json')
      await fs.writeFile(pdfPath, await searchable.save()); await fs.writeFile(textPath, textPages.map(p => `第 ${p.page} 页\n${p.text}`).join('\n\n')); await fs.writeFile(jsonPath, JSON.stringify({ pages: textPages }))
      outputs.push({ path: pdfPath, kind: 'pdf', metadata: { pages: pages.length, ocr: true } }, { path: textPath, kind: 'text' }, { path: jsonPath, kind: 'ocr-text' })
    } finally { signal.removeEventListener('abort', abort); await worker.terminate(); await pdf.destroy(); await fs.rm(langPath, { recursive: true, force: true }) }
  } else {
    progress(90, '保存整理后的 PDF')
    const file = path.join(outputDir, '整理后的文档.pdf'); await fs.writeFile(file, await combined.save())
    outputs.push({ path: file, kind: 'pdf', metadata: { pages: pages.length } })
  }
  return { files: outputs, message: `已完成 ${pages.length} 页${mode === 'ocr' ? '文字识别' : '处理'}` }
}
