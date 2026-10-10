import { Plus, X } from 'lucide-react'
import { emptyPair, type Pair } from '../contracts'

export function PairEditor({ label, rows, onChange, valuePlaceholder = '值' }: { label: string; rows: Pair[]; onChange: (rows: Pair[]) => void; valuePlaceholder?: string }) {
  const change = (index: number, patch: Partial<Pair>) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row))
  return <div className="pairs"><div className="pair-labels"><span /><span>名称</span><span>值</span><span /></div>{rows.map((row, index) => <div className="pair-row" key={index}>
    <input type="checkbox" aria-label={`启用${label} ${index + 1}`} checked={row.enabled} onChange={e => change(index, { enabled: e.target.checked })} />
    <input aria-label={`${label}名称 ${index + 1}`} placeholder="名称" value={row.name} maxLength={256} onChange={e => change(index, { name: e.target.value })} spellCheck={false} />
    <input aria-label={`${label}值 ${index + 1}`} placeholder={valuePlaceholder} value={row.value} maxLength={16384} onChange={e => change(index, { value: e.target.value })} spellCheck={false} />
    <button type="button" aria-label={`删除${label} ${index + 1}`} onClick={() => onChange(rows.length === 1 ? [emptyPair()] : rows.filter((_, i) => i !== index))}><X size={14} /></button>
  </div>)}<button type="button" className="subtle" disabled={rows.length >= 100} onClick={() => onChange([...rows, emptyPair()])}><Plus size={14} />添加{label}</button></div>
}
