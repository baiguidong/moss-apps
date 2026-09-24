import { useLayoutEffect, useRef } from 'react'
import { FolderPlus, LoaderCircle, Trash2 } from 'lucide-react'
import type { DriveStore, FileDialogState } from '../lib/store'

export function FileDialog({ dialog, store }: { dialog: FileDialogState; store: DriveStore }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = ref.current!
    element.showModal()
    return () => element.close()
  }, [])
  const creating = dialog.kind === 'create-folder'
  return <dialog ref={ref} className="file-dialog" aria-labelledby="file-dialog-title" aria-describedby="file-dialog-description" onCancel={event => { event.preventDefault(); store.closeDialog() }}>
    <form onSubmit={event => { event.preventDefault(); void store.submitDialog() }}>
      <div className={`dialog-icon ${creating ? '' : 'danger'}`}>{creating ? <FolderPlus size={22} /> : <Trash2 size={22} />}</div>
      <h2 id="file-dialog-title">{creating ? '新建目录' : '删除文件'}</h2>
      <p id="file-dialog-description">{creating ? <>创建到 <strong>{dialog.parent.name}</strong></> : <>确定删除 <strong>{dialog.file.name}</strong>？删除后无法恢复。</>}</p>
      {creating && <label className="name-field">目录名称<input autoFocus value={dialog.name} disabled={dialog.pending} aria-invalid={Boolean(dialog.error)} aria-describedby={dialog.error ? 'file-dialog-error' : undefined} onChange={event => store.setFolderName(event.target.value)} placeholder="输入目录名称" autoComplete="off" /></label>}
      {dialog.error && <p id="file-dialog-error" className="dialog-error" role="alert">{dialog.error}</p>}
      <div className="dialog-actions"><button type="button" className="quiet bordered" autoFocus={!creating} disabled={dialog.pending} onClick={store.closeDialog}>取消</button><button type="submit" className={creating ? 'primary' : 'destructive'} disabled={dialog.pending}>{dialog.pending && <LoaderCircle size={15} className="spin" />}{dialog.pending ? (creating ? '正在创建…' : '正在删除…') : (creating ? '创建' : '确认删除')}</button></div>
    </form>
  </dialog>
}
