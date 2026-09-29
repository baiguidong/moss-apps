import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Copy, Link, LoaderCircle, RefreshCw, Share2 } from 'lucide-react'
import type { CloudShare } from '@moss/app-sdk/cloud-storage'
import type { DriveState, DriveStore, ShareDialogState } from '../lib/store'
import { bytes, fullDate } from '../lib/format'
import { FileIcon } from './FileIcon'

function CopyButton({ share, info = false, disabled = false }: { share: CloudShare; info?: boolean; disabled?: boolean }) {
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    const text = info ? `${share.name}\n链接：${share.url}${share.accessCode ? `\n分享码：${share.accessCode}` : ''}\n有效期：${share.expiresAt === null ? '永久' : fullDate(share.expiresAt)}` : share.url
    try {
      let copied = false
      try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true } } catch { /* Try the embedded browser's copy command. */ }
      if (!copied) {
        const field = document.createElement('textarea'); field.value = text
        field.style.cssText = 'position:fixed;opacity:0'; document.body.append(field); field.select()
        const copied = document.execCommand('copy'); field.remove()
        if (!copied) throw new Error('Copy failed')
      }
      setMessage('已复制')
    } catch { setMessage('复制失败，请手动复制链接') }
    clearTimeout(timer.current); timer.current = setTimeout(() => setMessage(''), 3000)
  }
  return <span className="copy-control"><button type="button" className="quiet bordered" disabled={disabled} onClick={() => void copy()}><Copy size={14} />{info ? '复制分享信息' : '复制链接'}</button>{message && <span role="status" className="copy-status">{message}</span>}</span>
}

function localDate(value: number | null) {
  if (value === null || !Number.isFinite(value)) return ''
  const date = new Date(value)
  return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function ShareDialog({ dialog, store }: { dialog: ShareDialogState; store: DriveStore }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { ref.current!.showModal(); return () => ref.current?.close() }, [])
  const share = dialog.result
  return <dialog ref={ref} className="file-dialog share-dialog" aria-labelledby="share-title" onCancel={event => { event.preventDefault(); store.closeShare() }}>
    <form onSubmit={event => { event.preventDefault(); void store.createShare() }}>
      <div className="dialog-icon"><Share2 size={22} /></div>
      <h2 id="share-title">{share ? '分享详情' : '分享文件'}</h2><p className="share-file-name">{dialog.file.name}</p>
      {share ? <>
        <label className="name-field">分享链接<input readOnly autoFocus value={share.url} onFocus={event => event.target.select()} /></label>
        <dl className="share-details"><div><dt>分享码</dt><dd>{share.accessCode ?? '无需分享码'}</dd></div><div><dt>到期时间</dt><dd>{share.expiresAt === null ? '永久有效' : fullDate(share.expiresAt)}</dd></div></dl>
        {store.api.demo && <p className="muted">演示链接仅用于展示，不能在其他浏览器下载。</p>}
        <div className="share-copy-actions"><CopyButton share={share} /><CopyButton share={share} info /></div>
        <div className="dialog-actions"><button type="button" className="quiet bordered" onClick={() => { store.closeShare(); store.setView('shares') }}>查看已分享</button><button type="button" className="primary" onClick={store.closeShare}>完成</button></div>
      </> : <>
        <label className="name-field">有效期<select value={dialog.preset} disabled={dialog.pending} onChange={event => {
          const preset = event.target.value
          store.updateShare({ preset, expiresAt: preset === 'forever' ? null : preset === 'custom' ? Date.now() + 86400000 : Date.now() + Number(preset) * 86400000 })
        }} autoFocus><option value="1">1 天</option><option value="7">7 天</option><option value="30">30 天</option><option value="custom">自定义</option><option value="forever">永久有效</option></select></label>
        {dialog.preset === 'custom' && <label className="name-field">到期时间<input type="datetime-local" value={localDate(dialog.expiresAt)} disabled={dialog.pending} onChange={event => store.updateShare({ expiresAt: new Date(event.target.value).getTime() })} required /></label>}
        <label className="share-code-toggle"><input type="checkbox" checked={dialog.codeEnabled} disabled={dialog.pending} onChange={event => store.updateShare({ codeEnabled: event.target.checked })} />需要分享码</label>
        {dialog.codeEnabled && <label className="name-field">分享码<input value={dialog.code} placeholder="留空自动生成 6 位分享码" minLength={4} maxLength={12} pattern="[a-zA-Z0-9]{4,12}" autoComplete="off" disabled={dialog.pending} onChange={event => store.updateShare({ code: event.target.value })} /></label>}
        <p className="muted">{dialog.codeEnabled ? '打开链接后输入分享码即可下载。' : '获得链接的任何人都可以直接下载。'}</p>
        {dialog.error && <p className="dialog-error" role="alert">{dialog.error}</p>}
        <div className="dialog-actions"><button type="button" className="quiet bordered" disabled={dialog.pending} onClick={store.closeShare}>取消</button><button type="submit" className="primary" disabled={dialog.pending}>{dialog.pending && <LoaderCircle className="spin" size={15} />}{dialog.pending ? '正在创建…' : '创建分享'}</button></div>
      </>}
    </form>
  </dialog>
}

export function SharedFiles({ state, store }: { state: DriveState; store: DriveStore }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const status = (item: CloudShare) => item.state === 'active' && item.expiresAt !== null && item.expiresAt <= now ? 'expired' : item.state
  return <div className="shared-workspace">
    <div className="shared-toolbar"><h2>已分享文件</h2><button className="quiet" disabled={state.sharesLoading} onClick={() => void store.loadShares()}><RefreshCw size={15} className={state.sharesLoading ? 'spin' : ''} />更新分享</button></div>
    <div className="file-scroll" aria-busy={state.sharesLoading}>
      <table className="file-table share-table"><thead><tr><th>文件</th><th className="share-time">创建时间</th><th className="share-time">到期时间</th><th className="share-code-column">分享码</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>{state.shares.map(item => <tr key={item.id} data-testid="share-row"><td><div className="file-name"><FileIcon name={item.name} /><div className="file-description"><button className="folder-link name-text" title={item.name} onClick={() => store.viewShare(item)}>{item.name}</button><span className="muted share-size">{bytes(item.size)}</span><span className="share-mobile-details">创建：{fullDate(item.createdAt)}<br />到期：{item.expiresAt === null ? '永久' : fullDate(item.expiresAt)}<br />分享码：{item.accessCode ?? '无'}</span></div></div></td>
          <td className="share-time muted">{fullDate(item.createdAt)}</td><td className="share-time muted">{item.expiresAt === null ? '永久有效' : fullDate(item.expiresAt)}</td><td className="share-code-column"><code>{item.accessCode ?? '无'}</code></td>
          <td><span className={`share-status ${status(item)}`}>{({ active: '有效', expired: '已过期', revoked: '已取消', unavailable: '文件失效' })[status(item)]}</span></td>
          <td><div className="share-row-actions"><CopyButton share={item} info disabled={status(item) !== 'active'} /><button className="quiet" disabled={item.state === 'revoked' || state.revoking} onClick={() => store.openRevoke(item)}>取消分享</button></div></td>
        </tr>)}</tbody>
      </table>
      {state.sharesError && <div className="list-error" role="alert"><p>{state.sharesError}</p><button className="quiet bordered" onClick={() => void store.loadShares()}>重试</button></div>}
      {!state.shares.length && !state.sharesError && <div className="empty-state">{state.sharesLoading ? <><LoaderCircle className="spin" size={24} /><p>正在加载分享…</p></> : <><span className="empty-icon"><Link size={32} /></span><h2>还没有分享文件</h2><p>在“全部文件”中点击分享，生成下载链接。</p><button className="quiet bordered" onClick={() => store.setView('files')}>前往全部文件</button></>}</div>}
      {state.shareCursor && <div className="load-more"><button className="quiet bordered" disabled={state.sharesLoading} onClick={() => void store.loadShares(true)}>加载更多</button></div>}
    </div>
  </div>
}

export function RevokeDialog({ state, store }: { state: DriveState; store: DriveStore }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { ref.current!.showModal(); return () => ref.current?.close() }, [])
  return <dialog ref={ref} className="file-dialog" aria-labelledby="revoke-title" onCancel={event => { event.preventDefault(); store.closeRevoke() }}>
    <h2 id="revoke-title">取消分享</h2><p>取消 <strong>{state.revokeDialog!.name}</strong> 的分享？链接将失效，原文件仍然保留。</p>
    {state.revokeError && <p className="dialog-error" role="alert">{state.revokeError}</p>}
    <div className="dialog-actions"><button className="quiet bordered" autoFocus disabled={state.revoking} onClick={store.closeRevoke}>返回</button><button className="destructive" disabled={state.revoking} onClick={() => void store.revokeShare()}>{state.revoking ? '正在取消…' : '确认取消分享'}</button></div>
  </dialog>
}
