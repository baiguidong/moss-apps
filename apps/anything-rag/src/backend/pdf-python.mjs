import { spawn } from 'node:child_process'
import path from 'node:path'

function abortError(signal) { return signal?.reason instanceof Error ? signal.reason : Object.assign(new Error('操作已取消'), { name: 'AbortError' }) }

export function parsePdfWithPython({ file, parserPath, pythonPath, modulePath, signal, timeoutMs = 120000 }) {
  if (!pythonPath) throw new Error('Moss Python 运行时不可用，无法使用 PDF 兼容解析器')
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [parserPath, '--path', file], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', PYTHONPATH: modulePath || '' },
    })
    let stdout = '', stderr = '', settled = false
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); error ? reject(error) : resolve(value) }
    const onAbort = () => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1500).unref?.(); finish(abortError(signal)) }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`PDF 解析超时：${path.basename(file)}`)) }, timeoutMs)
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    signal?.addEventListener('abort', onAbort, { once: true })
    child.once('error', error => finish(error))
    child.once('close', code => {
      if (signal?.aborted) return finish(abortError(signal))
      if (code !== 0) return finish(new Error(stderr.trim() || `PDF 解析失败（${code}）`))
      try {
        const result = JSON.parse(stdout)
        finish(null, { text: String(result.text || ''), pages: Number(result.pages) || 0, extractedPages: Number(result.extractedPages) || 0 })
      } catch (error) { finish(new Error(`PDF 解析器返回无效结果：${error.message}`)) }
    })
  })
}
