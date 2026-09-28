import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
export function CopyButton({ value, label = '复制', disabled = false }: { value: string; label?: string; disabled?: boolean }) {
  const [state, setState] = useState(''), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { setState(''); return () => clearTimeout(timer.current) }, [value])
  return <span className="copy-control"><button type="button" disabled={disabled} aria-label={label} onClick={async () => {
    try { await navigator.clipboard.writeText(value); setState('已复制') } catch { setState('请选中文本后复制') }
    clearTimeout(timer.current); timer.current = setTimeout(() => setState(''), 2200)
  }}>{state === '已复制' ? <Check size={14} /> : <Copy size={14} />}{state || label}</button></span>
}
export function ErrorMessage({ error }: { error: string }) { return error ? <p className="error" role="alert">{error}</p> : null }
export function ToolHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <header className="tool-header"><div><h1>{title}</h1><p>{description}</p></div><div className="header-actions">{children}</div></header>
}
export function Editor({ label, value, onChange, readOnly = false, placeholder, actions }: { label: string; value: string; onChange?: (s: string) => void; readOnly?: boolean; placeholder?: string; actions?: ReactNode }) {
  return <div className="editor"><div className="editor-toolbar"><span>{label}</span><div>{actions}</div></div><textarea aria-label={label} value={value} onChange={e => onChange?.(e.target.value)} readOnly={readOnly} spellCheck={false} placeholder={placeholder} /><div className="editor-meta">{value.length.toLocaleString()} 字符</div></div>
}
