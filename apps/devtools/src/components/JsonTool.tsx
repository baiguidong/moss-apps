import { useState } from 'react'
import type { JsonInput, JsonResult } from '../contracts'
import { invoke } from '../lib/host'
import { useOperation } from '../lib/operation'
import { CopyButton, Editor, ErrorMessage, ToolHeader } from './shared'
export function JsonTool() {
  const [input, setInput] = useState(''), [indent, setIndent] = useState<JsonInput['indent']>('2')
  const task = useOperation<JsonResult>()
  const run = (operation: JsonInput['operation']) => void task.run(() => invoke('json.process', { input, indent, operation }))
  return <><ToolHeader title="JSON 工具" description="格式化、压缩与校验，保留大整数精度和字段顺序。"><button onClick={() => { task.clear(); setInput('{"name":"Moss","id":9007199254740993,"enabled":true,"tags":["local","tools"]}') }}>填入示例</button><button onClick={() => { task.clear(); setInput('') }}>清空</button></ToolHeader>
    <div className="tool-options"><label className="inline-field">缩进<select value={indent} onChange={e => { task.clear(); setIndent(e.target.value as JsonInput['indent']) }}><option value="2">2 个空格</option><option value="4">4 个空格</option><option value="tab">Tab</option></select></label></div>
    <div className="editors"><Editor label="JSON 输入" value={input} onChange={value => { task.clear(); setInput(value) }} placeholder={'粘贴 JSON，例如 {"name":"Moss"}'} /><Editor label="JSON 结果" value={task.result?.text || ''} readOnly placeholder="处理结果显示在这里" actions={<CopyButton value={task.result?.text || ''} disabled={!task.result} />} /></div>
    <div className="action-row"><button className="primary" disabled={task.busy || !input.trim()} onClick={() => run('format')}>格式化</button><button className="bordered" disabled={task.busy || !input.trim()} onClick={() => run('minify')}>压缩</button><button className="bordered" disabled={task.busy || !input.trim()} onClick={() => run('validate')}>校验</button><button disabled={!task.result} onClick={() => { setInput(task.result!.text); task.clear() }}>结果用作输入</button></div>
    <ErrorMessage error={task.error} />{task.result && <p className="success" role="status">{task.result.message}</p>}<p className="hint">接受标准 JSON，不接受注释或末尾多余逗号。格式错误会给出行号和列号。</p>
  </>
}
