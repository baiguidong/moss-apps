import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PDFDocument, degrees, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

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
  return { kind: 'pdf', metadata: { pages: document.getPageCount(), fields: readFields(document) } }
}
export function readFields(document) {
  return document.getForm().getFields().map(field => {
    const base = { name: field.getName(), readOnly: field.isReadOnly() }
    if (field instanceof PDFTextField) return { ...base, type: 'text', value: field.getText() || '', maxLength: field.getMaxLength(), multiline: field.isMultiline() }
    if (field instanceof PDFCheckBox) return { ...base, type: 'checkbox', value: field.isChecked() }
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) return { ...base, type: 'select', value: field.getSelected(), options: field.getOptions(), multiple: field.isMultiselect() }
    if (field instanceof PDFRadioGroup) return { ...base, type: 'radio', value: field.getSelected() || '', options: field.getOptions() }
    return { ...base, type: 'unsupported' }
  })
}
async function fillForm(document, options) {
  const form = document.getForm(), fields = readFields(document)
  document.registerFontkit(fontkit)
  const font = await document.embedFont(await fs.readFile(new URL('../../assets/fonts/NotoSansSC-Regular.ttf', import.meta.url)), { subset: false })
  for (const [name, value] of Object.entries(options.fields || {})) {
    const info = fields.find(f => f.name === name)
    if (!info || info.readOnly || info.type === 'unsupported') throw new Error(`表单字段不可填写：${name}`)
    const field = form.getField(name)
    if (info.type === 'text') {
      if (typeof value !== 'string' || value.length > (info.maxLength ?? 10000)) throw new Error(`文字字段长度或类型无效：${name}`)
      const supported = new Set(font.getCharacterSet())
      if ([...value].some(char => !['\n','\r','\t'].includes(char) && !supported.has(char.codePointAt(0)))) throw new Error(`字段包含字体不支持的字符：${name}`)
      field.setText(value)
    } else if (info.type === 'checkbox') {
      if (typeof value !== 'boolean') throw new Error(`勾选字段需要布尔值：${name}`)
      value ? field.check() : field.uncheck()
    } else {
      const values = Array.isArray(value) ? value : [value]
      if (!values.length || values.some(v => typeof v !== 'string' || !info.options.includes(v)) || (!info.multiple && values.length !== 1)) throw new Error(`选项无效：${name}`)
      field.select(info.type === 'radio' ? values[0] : values)
    }
  }
  form.updateFieldAppearances(font)
  if (options.flatten) form.flatten({ updateFieldAppearances: false })
}
export function validate(input, files) {
  if(input.parentId!==undefined&&!/^[a-f0-9-]{36}$/.test(input.parentId))throw new Error('原任务 ID 无效')
  if(input.title!==undefined&&(typeof input.title!=='string'||!input.title.trim()||input.title.length>120))throw new Error('标题需要 1–120 字')
  if (input.options?.mode === 'create') {
    if (typeof input.options.content !== 'string' || !input.options.content.trim() || input.options.content.length > 200000) throw new Error('请提供 1–200000 字的 PDF 正文')
    return { title: input.title || 'PDF 文档', fileIds: [], parentId: input.parentId, options: { mode: 'create', content: input.options.content } }
  }
  if (!Array.isArray(input.fileIds) || !input.fileIds.length || input.fileIds.length > 50) throw new Error('请选择 PDF 文件')
  const fileIds = [...new Set(input.fileIds)], selected = fileIds.map(id => { const file = files.find(f => f.id === id && f.kind === 'pdf'); if (!file) throw new Error('选择的 PDF 不存在'); return file })
  const options = input.options || {}, mode = options.mode || 'arrange'
  if (!['arrange', 'split', 'ocr', 'extract', 'form', 'render'].includes(mode)) throw new Error('不支持的 PDF 操作')
  if (mode === 'form') {
    if (fileIds.length !== 1) throw new Error('填写表单时请选择一个 PDF')
    if (!options.fields || typeof options.fields !== 'object' || Array.isArray(options.fields) || !Object.keys(options.fields).length) throw new Error('请填写至少一个表单字段')
    if (options.flatten !== undefined && typeof options.flatten !== 'boolean') throw new Error('展平设置无效')
  }
  const pages = options.pages || selected.flatMap(file => Array.from({ length: file.metadata.pages }, (_, page) => ({ fileId: file.id, page, rotation: 0 })))
  if (!Array.isArray(pages) || !pages.length || pages.length > (mode === 'ocr' ? 80 : 500)) throw new Error(mode === 'ocr' ? '每次 OCR 请选择 1–80 页' : '请选择 1–500 页')
  for (const item of pages) {
    const file = selected.find(f => f.id === item.fileId)
    if (!file || !Number.isInteger(item.page) || item.page < 0 || item.page >= file.metadata.pages || ![0, 90, 180, 270].includes(item.rotation || 0)) throw new Error('页面或旋转角度无效')
  }
  const language = options.language || 'chi_sim+eng'
  if (!['eng', 'chi_sim', 'chi_sim+eng'].includes(language)) throw new Error('请选择中文、英文或中英混合')
  return { fileIds, parentId: input.parentId, title: input.title || `${mode === 'form' ? '填写表单' : mode === 'extract' ? '提取文字' : mode === 'ocr' ? 'OCR 识别' : mode === 'split' ? '拆分' : mode === 'render' ? '渲染' : '整理'} ${pages.length} 页 PDF`, options: { mode, ...(mode === 'form' ? { fields: options.fields, flatten: options.flatten === true } : {}), pages: pages.map(p => ({ fileId: p.fileId, page: p.page, rotation: p.rotation || 0 })), language } }
}
export async function execute({ input, files, outputDir, signal, progress }) {
  const { mode, pages, language } = input.options, documents = new Map(), outputs = []
  if (mode === 'create') return createPdf(input, outputDir, signal)
  for (const id of input.fileIds) documents.set(id, await load(files.find(f => f.id === id).path))
  if (mode === 'form') {
    signal.throwIfAborted(); progress(20, '填写 PDF 表单')
    const document = documents.get(input.fileIds[0])
    await fillForm(document, input.options)
    const output = path.join(outputDir, '填写后的表单.pdf')
    await fs.writeFile(output, await document.save({ updateFieldAppearances: false }))
    return { files: [{ path: output, kind: 'pdf', metadata: { pages: document.getPageCount(), fields: readFields(document) } }], message: input.options.flatten ? '表单已填写并展平' : '表单已填写，保留可编辑字段' }
  }
  const combined = await PDFDocument.create()
  for (const item of pages) {
    signal.throwIfAborted()
    const [page] = await combined.copyPages(documents.get(item.fileId), [item.page])
    page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360)); combined.addPage(page)
  }
  if (mode === 'render') return renderPdf(await combined.save(), outputDir, signal, progress)
  if (mode === 'extract') {
    const { DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas')
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D })
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await getDocument({ data: await combined.save(), isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: `${path.dirname(require.resolve('pdfjs-dist/package.json'))}/standard_fonts/`, cMapUrl: `${path.dirname(require.resolve('pdfjs-dist/package.json'))}/cmaps/`, cMapPacked: true }).promise
    const textPages = []
    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        signal.throwIfAborted(); progress((i - 1) / pdf.numPages * 100, `提取第 ${i} 页`)
        const page = await pdf.getPage(i), content = await page.getTextContent()
        textPages.push({ page: i, source: pages[i - 1], text: content.items.map(item => item.str ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, '$1').trim() })
        page.cleanup()
      }
    } finally { await pdf.destroy() }
    const txt = path.join(outputDir, '提取文字.txt'), json = path.join(outputDir, '提取文字.json')
    await fs.writeFile(txt, textPages.map(p => `第 ${p.page} 页\n${p.text}`).join('\n\n'))
    await fs.writeFile(json, JSON.stringify({ pages: textPages }, null, 2))
    return { files: [{ path: txt, kind: 'text' }, { path: json, kind: 'ocr-text' }], message: textPages.some(p => p.text) ? `已提取 ${pages.length} 页文字` : '未发现文字层；扫描件请使用 OCR' }
  } else if (mode === 'split') {
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


async function createPdf(input, outputDir, signal) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit)
  // Keep the full static TTF: fontkit subsetting drops outlines in this CJK font.
  const font = await doc.embedFont(await fs.readFile(new URL('../../assets/fonts/NotoSansSC-Regular.ttf', import.meta.url)), { subset: false })
  const supported=new Set(font.getCharacterSet());if([...input.options.content].some(c=>!['\n','\r','\t'].includes(c)&&!supported.has(c.codePointAt(0))))throw new Error('正文包含当前字体不支持的字符，请改用文档创作 App')
  let page, y; const newPage = () => { page = doc.addPage([595.28, 841.89]); y = 790 }
  newPage()
  for (const paragraph of input.options.content.split('\n')) {
    signal.throwIfAborted();let line = ''
    const draw = () => { if(y < 55) newPage();page.drawText(line,{x:50,y,size:12,font});y-=21;line='' }
    for (const char of paragraph) { if(font.widthOfTextAtSize(line+char,12)>495 && line) draw();line+=char }
    draw()
  }
  const output=path.join(outputDir,'文档.pdf'),bytes=await doc.save();await fs.writeFile(output,bytes)
  const render = await renderPdf(bytes,outputDir,signal,()=>{})
  return { files: [{path:output,kind:'pdf',metadata:{pages:doc.getPageCount(),fields:[]}},...render.files], message:'PDF 已生成并渲染检查' }
}
async function renderPdf(bytes,outputDir,signal,progress) {
  const { DOMMatrix, ImageData, Path2D, createCanvas } = await import('@napi-rs/canvas');Object.assign(globalThis,{DOMMatrix,ImageData,Path2D})
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const root=path.dirname(require.resolve('pdfjs-dist/package.json'))
  const pdf=await getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,standardFontDataUrl:root+'/standard_fonts/',cMapUrl:root+'/cmaps/',cMapPacked:true}).promise
  const files=[]
  try {for(let i=1;i<=pdf.numPages;i++){signal.throwIfAborted();progress((i-1)/pdf.numPages*100,`渲染第 ${i} 页`);const page=await pdf.getPage(i),viewport=page.getViewport({scale:1.25}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const output=path.join(outputDir,`page-${i}.png`);await fs.writeFile(output,canvas.toBuffer('image/png'));files.push({path:output,kind:'image',metadata:{page:i}});page.cleanup()}} finally {await pdf.destroy()}
  return {files,message:`已渲染 ${files.length} 页`}
}
