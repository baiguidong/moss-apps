import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { validateSettings, type McpServer, type SaveInput } from '../contracts'
import { Dialog } from './dialog'

export function MemoryEditor({ server, memoryFile, onClose, onSave }: { server?: McpServer; memoryFile: string; onClose: () => void; onSave: (input: SaveInput) => Promise<void> }) {
  const [excluded, setExcluded] = useState(server?.config.disabledTools?.join('\n') || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      const input = validateSettings({ disabledTools: excluded.split('\n').map(name => name.trim()).filter(Boolean) })
      setBusy(true); await onSave(input); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <Dialog title="记忆设置" description="保存后会自动重新检查连接。" onClose={onClose} busy={busy}>
    <form onSubmit={save}><div className="editor-scroll"><fieldset className="editor-body" disabled={busy}>
      <label className="field"><span>记忆文件</span><input readOnly value={memoryFile} /><small>保存在此 App 的数据目录。重启和更新 App 会继续使用同一份记忆。</small></label>
      <label className="field"><span>不启用的工具</span><textarea rows={4} spellCheck={false} value={excluded} onChange={event => setExcluded(event.target.value)} placeholder="每行一个工具名称，可留空" /><small>例如 delete_entities。保存后，忙碌对话会在本轮结束后更新工具。</small></label>
      {error && <p className="error-message" role="alert">{error}</p>}
    </fieldset></div><footer className="dialog-footer"><button className="button" type="button" onClick={onClose} disabled={busy}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <ArrowRight size={15} />}{busy ? '保存中' : '保存并连接'}</button></footer></form>
  </Dialog>
}
