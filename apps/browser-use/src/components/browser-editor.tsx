import { useState, type FormEvent } from 'react'
import { ArrowRight, ChevronDown, Loader2 } from 'lucide-react'
import { browserFields, configFromFields, EXTENSION_URL, PLAYWRIGHT_CDP, type BrowserFields } from '../browser-config'
import type { McpServer, SaveInput } from '../contracts'
import { Dialog } from './dialog'

export function BrowserEditor({ server, onClose, onSave }: { server: McpServer; onClose: () => void; onSave: (input: SaveInput) => Promise<void> }) {
  const [fields, setFields] = useState(() => browserFields(server.config))
  const [excluded, setExcluded] = useState(server.config.disabledTools?.join('\n') || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const update = <K extends keyof BrowserFields>(key: K, value: BrowserFields[K]) => setFields(previous => ({ ...previous, [key]: value }))
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      const config = configFromFields(server.config, fields, excluded)
      setBusy(true)
      await onSave({ name: PLAYWRIGHT_CDP, previousName: PLAYWRIGHT_CDP, enabled: true, config })
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <Dialog title="浏览器连接设置" description="保存后会自动重新检查连接。" onClose={onClose} busy={busy}>
    <form onSubmit={save}><div className="editor-scroll"><fieldset className="editor-body" disabled={busy}>
      <label className="field"><span>连接方式</span><select value={fields.mode} onChange={event => setFields(previous => ({ ...previous, mode: event.target.value as BrowserFields['mode'], '--cdp-endpoint': '' }))}><option value="managed">Moss 专用浏览器（推荐）</option><option value="extension">日常 Chrome</option><option value="cdp">已有 CDP 服务（高级）</option></select></label>
      {fields.mode === 'managed' ? <p className="browser-note">实际操作网页时才打开专用浏览器，固定保留登录状态，重复连接复用同一个实例。无需扩展，与日常 Chrome 分开运行。</p> : fields.mode === 'extension' ? <p className="browser-note">使用 Chrome 已有的标签页、登录状态和用户配置。首次使用请<a href={EXTENSION_URL} target="_blank" rel="noreferrer">安装 Playwright 扩展</a>，操作网页时在 Chrome 中允许连接。</p> : <label className="field"><span>CDP 地址</span><input autoComplete="off" spellCheck={false} value={fields['--cdp-endpoint']} onChange={event => update('--cdp-endpoint', event.target.value)} placeholder="http://127.0.0.1:9222" /><small>只连接已开启的服务。连接失败时不会启动或重启 Chrome。</small></label>}
      <label className="field"><span>输出目录</span><input autoComplete="off" spellCheck={false} value={fields['--output-dir']} onChange={event => update('--output-dir', event.target.value)} placeholder="~/.moss/artifacts/playwright" /><small>路径支持 ~/；含空格的路径无需加引号。</small></label>
      <details className="advanced"><summary><ChevronDown size={15} />更多选项</summary><div>
        {fields.mode === 'managed' && <label className="field"><span>专用浏览器 CDP 地址</span><input autoComplete="off" spellCheck={false} value={fields['--cdp-endpoint']} onChange={event => update('--cdp-endpoint', event.target.value)} placeholder="http://127.0.0.1:9222" /><small>仅在本机端口冲突时修改。每个端口保留固定的专用浏览器配置。</small></label>}
        {fields.mode === 'extension' && <>
          <label className="field"><span>扩展连接令牌（可选）</span><input type="password" autoComplete="off" value={fields.extensionToken} onChange={event => update('extensionToken', event.target.value)} placeholder={Object.hasOwn(server.config.env || {}, 'PLAYWRIGHT_MCP_EXTENSION_TOKEN') ? '已保存，留空保留原令牌' : '粘贴扩展页面提供的连接令牌'} /><small>保存后可免去重复连接确认，令牌由 Moss 凭据存储保管。</small></label>
          <label className="field"><span>Chrome 用户配置</span><input autoComplete="off" spellCheck={false} value={fields['--profile-dir-name']} onChange={event => update('--profile-dir-name', event.target.value)} placeholder="留空，使用最近使用且已安装扩展的配置" /><small>有多个用户时，可填写 Default 或 Profile 1 等现有配置目录名。</small></label>
          <label className="field"><span>Chrome 路径</span><input autoComplete="off" spellCheck={false} value={fields['--executable-path']} onChange={event => update('--executable-path', event.target.value)} placeholder="留空，使用系统 Chrome" /><small>自定义路径时，也需填写下方已安装扩展的现有用户目录。</small></label>
          <label className="field"><span>已有 Chrome 用户目录</span><input autoComplete="off" spellCheck={false} value={fields['--user-data-dir']} onChange={event => update('--user-data-dir', event.target.value)} placeholder="留空，使用 Chrome 默认用户目录" /><small>仅用于自定义安装位置，填写已安装扩展的现有目录。</small></label>
        </>}
        <label className="field"><span>其他启动参数</span><textarea rows={3} spellCheck={false} value={fields.extra} onChange={event => update('extra', event.target.value)} placeholder="每行一个参数" /></label>
        <label className="field"><span>不启用的工具</span><textarea rows={2} spellCheck={false} value={excluded} onChange={event => setExcluded(event.target.value)} placeholder="每行一个工具名称，可留空" /></label>
      </div></details>
      {error && <p className="error-message" role="alert">{error}</p>}
    </fieldset></div><footer className="dialog-footer"><button className="button" type="button" onClick={onClose} disabled={busy}>取消</button><button className="button primary" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <ArrowRight size={15} />}{busy ? '保存中' : '保存并连接'}</button></footer></form>
  </Dialog>
}
