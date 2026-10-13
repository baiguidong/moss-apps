import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { TITLE, validateSettings, type Settings } from '../contracts'
import { Dialog } from './dialog'
export function SettingsEditor({ settings, onClose, onSave }: { settings: Settings; onClose: () => void; onSave: (input: Settings) => Promise<void> }) {
  const [paths, setPaths] = useState(settings.directories.join('\n'))
  const [excluded, setExcluded] = useState(settings.disabledTools.join('\n'))

  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)
      const input = validateSettings({ directories: lines(paths), disabledTools: lines(excluded),  })
      setBusy(true); await onSave(input); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <Dialog title={`${TITLE}设置`} description="会话工作目录自动追加并优先使用；公共目录可留空。保存后自动检查服务。" onClose={onClose} busy={busy}>
    <form onSubmit={save}><div className="editor-scroll"><fieldset className="editor-body" disabled={busy}>
      <label className="field"><span>公共目录（可选）</span><textarea rows={4} autoComplete="off" spellCheck={false} value={paths} onChange={event => setPaths(event.target.value)} placeholder="~/Documents" /><small>每行一个已有目录，最多 32 个。工具可读写这些目录及其子目录；支持 ~/，含空格的路径无需加引号。</small></label>

      <label className="field"><span>不启用的工具</span><textarea rows={3} spellCheck={false} value={excluded} onChange={event => setExcluded(event.target.value)} placeholder="每行一个工具名称，可留空" /><small>例如 write_file。排除工具不会修改现有文件。</small></label>
      {error && <p className="error-message" role="alert">{error}</p>}
    </fieldset></div><footer className="dialog-footer"><button className="button" type="button" onClick={onClose} disabled={busy}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <ArrowRight size={15} />}{busy ? '保存中' : '保存设置'}</button></footer></form>
  </Dialog>
}
