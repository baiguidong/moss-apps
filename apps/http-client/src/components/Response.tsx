import { useMemo, useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import type { RequestResult } from '../contracts'
import { formatJson } from '../core/json'
import { CopyButton } from './Fields'

export function Response({ result, busy }: { result: RequestResult | null; busy: boolean }) {
  const [tab, setTab] = useState('body'), [pretty, setPretty] = useState(true)
  const formatted = useMemo(() => {
    if (!result || result.bodyEncoding !== 'text' || result.truncated) return null
    try { return formatJson(result.body) } catch { return null }
  }, [result])
  return <section className="response panel" aria-label="响应区" aria-busy={busy}>
    <div className="response-heading"><h2>响应</h2>{result && <div className="metrics"><strong className={result.status >= 400 ? 'bad' : result.status >= 300 ? 'warning-text' : 'good'}>{result.status} {result.statusText}</strong><span>{result.durationMs.toLocaleString()} ms</span><span>{result.bytes < 1024 ? `${result.bytes} B` : `${(result.bytes / 1024).toFixed(1)} KiB`}{result.truncated ? '（已截断）' : ''}</span></div>}</div>
    {!result ? <div className="empty"><ArrowDownToLine size={25} /><p>{busy ? '正在等待响应…' : '响应会显示在这里'}</p><span>{busy ? '可随时取消当前请求。' : '填写地址，点击“发送请求”开始调试。'}</span></div> : <>
      <div className="response-url"><span>{result.method}</span><code>{result.url}</code></div>
      {result.notice && <p className="notice">{result.notice}</p>}
      {result.truncated && <p className="notice">响应超过 1 MiB，仅保留前 1 MiB，已停止读取。</p>}
      {result.bodyEncoding === 'base64' && <p className="notice">二进制或无法解码的响应，以 Base64 显示。</p>}
      <div className="response-toolbar"><div className="tabs" aria-label="响应内容">
        <button type="button" aria-pressed={tab === 'body'} onClick={() => setTab('body')}>正文</button>
        <button type="button" aria-pressed={tab === 'headers'} onClick={() => setTab('headers')}>响应头 <small>{result.headers.length}</small></button>
        {result.redirects.length > 0 && <button type="button" aria-pressed={tab === 'redirects'} onClick={() => setTab('redirects')}>跳转 <small>{result.redirects.length}</small></button>}
      </div>{tab === 'body' && <div className="response-actions">{formatted !== null && <button type="button" aria-pressed={pretty} onClick={() => setPretty(!pretty)}>{pretty ? '查看原文' : '格式化 JSON'}</button>}<CopyButton value={pretty && formatted !== null ? formatted : result.body} label="复制响应" /></div>}</div>
      {tab === 'body' && (result.body ? <textarea aria-label="响应正文" className="response-body" readOnly spellCheck={false} value={pretty && formatted !== null ? formatted : result.body} /> : <p className="empty-body">此响应没有正文。</p>)}
      {tab === 'headers' && <dl className="header-list">{result.headers.map((header, i) => <div key={i}><dt>{header.name}</dt><dd>{header.value}</dd></div>)}</dl>}
      {tab === 'redirects' && <ol className="redirect-list">{result.redirects.map((redirect, i) => <li key={i}><strong>{redirect.status}</strong><code>{redirect.url}</code></li>)}<li><strong>{result.status}</strong><code>{result.url}</code></li></ol>}
    </>}
  </section>
}
