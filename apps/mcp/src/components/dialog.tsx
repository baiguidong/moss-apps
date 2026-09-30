import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
export function Dialog({ title, description, onClose, busy, children, compact = false }: { title: string; description?: string; onClose: () => void; busy?: boolean; children: ReactNode; compact?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const el = ref.current!; el.showModal(); return () => el.close() }, [])
  return <dialog ref={ref} className={`dialog ${compact ? 'compact' : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <header className="dialog-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" aria-label="关闭" onClick={onClose} disabled={busy}><X size={18} /></button></header>
    {children}
  </dialog>
}
