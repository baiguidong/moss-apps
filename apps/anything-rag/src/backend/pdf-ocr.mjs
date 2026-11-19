import { setTimeout as delay } from 'node:timers/promises'
import { createAppCapabilitiesClient } from '@moss/app-sdk/app-capabilities'

const pdfAppId = 'moss.pdf'
const requiredTools = ['pdf_import', 'pdf_create', 'pdf_status', 'pdf_inspect']
const pendingStates = new Set(['queued', 'running', 'canceling'])
const unavailableReasons = {
  not_installed: '扫描 PDF 需要 OCR，请先在 Moss 中安装「PDF 创作」。',
  disabled: '「PDF 创作」已停用，请启用后重新导入扫描 PDF。',
  instance_disabled: '「PDF 创作」实例已停用，请启用后重新导入扫描 PDF。',
  incompatible_version: '「PDF 创作」版本不兼容，请更新后重新导入扫描 PDF。',
}

export function createPdfOcr(host) {
  const client = createAppCapabilitiesClient(host)
  return async (file, { signal, onProgress }) => {
    const timeout = AbortSignal.timeout(240_000)
    const options = { signal: AbortSignal.any([signal, timeout]) }
    try {
      onProgress('正在联系「PDF 创作」')
      const { tools } = await client.listTools({ appId: pdfAppId }, options)
      const refs = new Map(tools.filter(tool => tool.source === 'contribution').map(tool => [tool.name, tool.toolRef]))
      if (requiredTools.some(name => !refs.has(name))) throw new Error('请更新「PDF 创作」，以启用扫描 PDF 的 OCR。')
      const invoke = (name, input) => client.invokeTool(refs.get(name), input, options)
      const { files, errors } = await invoke('pdf_import', { paths: [file] })
      const imported = files?.[0]
      if (!imported) throw new Error(errors?.[0]?.message || '「PDF 创作」无法导入这个文件。')
      const pageCount = imported.metadata?.pages
      if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 80) {
        throw new Error('「PDF 创作」每次支持 OCR 识别 1–80 页。')
      }
      const task = await invoke('pdf_create', { fileIds: [imported.id], options: { mode: 'ocr', language: 'chi_sim+eng' } })
      let status = task
      while (pendingStates.has(status.status)) {
        if (status.message) onProgress(status.message)
        await delay(800, undefined, options)
        status = await invoke('pdf_status', { id: task.id })
      }
      if (status.status !== 'succeeded') throw new Error(status.error || '「PDF 创作」OCR 任务未完成。')

      onProgress('正在读取 OCR 文字')
      const pages = []
      for (let page = 1; page <= pageCount; page++) {
        const { units } = await invoke('pdf_inspect', { id: task.id, page, limit: 1 })
        const text = units?.[0]?.text?.trim()
        if (text) pages.push({ page, text })
      }
      if (!pages.length) throw new Error('OCR 未识别到可读文字。')
      return pages
    } catch (error) {
      signal.throwIfAborted()
      if (timeout.aborted) throw new Error('「PDF 创作」OCR 识别超时，请重试。', { cause: error })
      const message = unavailableReasons[error.details?.reason]
      if (message) throw new Error(message, { cause: error })
      if (error.code === 'APP_PERMISSION_DENIED') {
        if (error.message === 'Nested cross-App calls are not supported') {
          throw new Error('当前 Moss 无法从知识库后台调用 PDF 创作，请更新 Moss 后重试。', { cause: error })
        }
        throw new Error('知识库缺少跨 App 调用授权，请在 Moss 中允许调用「PDF 创作」。', { cause: error })
      }
      throw error
    }
  }
}
