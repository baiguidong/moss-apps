import { useState } from 'react'
import type { TextResult } from '../contracts'
import { invoke } from '../lib/host'
import { useOperation } from '../lib/operation'
import { CopyButton, Editor, ErrorMessage, ToolHeader } from './shared'
export function Base64Tool() {
  const [input, setInput] = useState(''), [urlSafe, setUrlSafe] = useState(false)
  const task = useOperation<TextResult>()
  function run(operation: 'encode' | 'decode') { void task.run(() => invoke('base64.convert', { operation, input, urlSafe })) }
  return <><ToolHeader title="Base64 编解码" description="UTF-8 文本与 Base64 互转，支持中文和 Emoji。"><button onClick={() => { task.clear(); setInput('你好，Moss 👋') }}>填入示例</button><button onClick={() => { task.clear(); setInput('') }}>清空</button></ToolHeader>
    <div className="tool-options"><label className="check"><input type="checkbox" checked={urlSafe} onChange={e => { task.clear(); setUrlSafe(e.target.checked) }} />URL-safe（使用 - 和 _，编码时省略 =）</label></div>
    <div className="editors"><Editor label="输入内容" value={input} onChange={value => { task.clear(); setInput(value) }} placeholder="粘贴原文或 Base64 文本" /><Editor label="转换结果" value={task.result?.text || ''} readOnly placeholder="编码或解码后，结果显示在这里" actions={<CopyButton value={task.result?.text || ''} disabled={!task.result} />} /></div>
    <div className="action-row"><button className="primary" disabled={task.busy} onClick={() => run('encode')}>编码为 Base64</button><button className="bordered" disabled={task.busy} onClick={() => run('decode')}>解码为文本</button><button disabled={!task.result} onClick={() => { setInput(task.result!.text); task.clear() }}>结果用作输入</button>{task.busy && <span role="status">转换中…</span>}</div>
    <ErrorMessage error={task.error} /><p className="hint">Base64 是编码，不是加密。解码会检查格式与 UTF-8；本工具用于文本，不将二进制内容显示为乱码。</p>
  </>
}
