import * as React from 'react'
import { formatBytes } from '../../../lib/trace/formatBytes'

type Row = { location: string; kind: 'system' | 'tool' | 'message'; name?: string; characters: number; bytes: number; duplicateOf?: string; truncated?: boolean }
const labels = { system: '系统 / 开发者文本', tool: '工具定义', message: '消息文本' }

export function PromptDiagnostics({ value }: { value: unknown }) {
  const [showAll, setShowAll] = React.useState(false)
  if (!value || typeof value !== 'object') return null
  const data = value as { version?: number; metric?: string; rows?: Row[]; truncated?: boolean; unmeasuredBlocks?: number }
  if (data.version !== 1 || data.metric !== 'utf8-content-bytes' || !Array.isArray(data.rows)) return null
  const rows = data.rows.slice(0, 256).filter(row => row && Object.hasOwn(labels, row.kind) && typeof row.location === 'string'
    && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && Number.isSafeInteger(row.characters) && row.characters >= 0)
    .sort((a, b) => b.bytes - a.bytes)
  const visible = showAll ? rows : rows.slice(0, 12)
  const duplicates = rows.filter(row => typeof row.duplicateOf === 'string').length
  return <div data-testid="prompt-diagnostics" className="space-y-3 text-[12px] text-[var(--color-text-secondary)]">
    <p>按本条记录的实际请求统计，按体积从大到小排列。文本按 UTF-8 内容计量，工具定义包含 JSON 结构；这些数值不等于计费 token。</p>
    <p>已计量 {formatBytes(rows.reduce((sum, row) => sum + row.bytes, 0))} · {rows.length} 个片段{duplicates > 0 ? ` · ${duplicates} 个完全重复片段` : ''}</p>
    {(data.truncated || (data.unmeasuredBlocks ?? 0) > 0) && <p role="status">统计不完整：{data.truncated ? '已达到诊断采集上限。' : ''}{(data.unmeasuredBlocks ?? 0) > 0 ? '图片、工具结果等非文本块未计入。' : ''}</p>}
    <div className="overflow-x-auto rounded border border-[var(--border)]">
      <table className="w-full text-left"><thead><tr className="border-b border-[var(--border)]"><th className="p-2">请求位置</th><th className="p-2 text-right">字符</th><th className="p-2 text-right">体积</th></tr></thead>
        <tbody>{visible.map(row => <tr key={row.location} className="border-b border-[var(--border)] last:border-b-0">
          <td className="p-2"><div>{labels[row.kind]}{row.name ? ` · ${row.name}` : ''}</div><code className="break-all text-[11px]">{row.location}</code>
            {row.duplicateOf && <div className="mt-1 break-all">与 {row.duplicateOf} 完全重复；可能是有意重复，请结合上下文判断。</div>}</td>
          <td className="p-2 text-right tabular-nums">{row.characters.toLocaleString()}{row.truncated ? '+' : ''}</td>
          <td className="whitespace-nowrap p-2 text-right tabular-nums">{formatBytes(row.bytes)}{row.truncated ? '+' : ''}</td>
        </tr>)}</tbody></table>
    </div>
    {rows.length > 12 && <button type="button" className="underline" onClick={() => setShowAll(value => !value)}>{showAll ? '收起明细' : `显示全部 ${rows.length} 个片段`}</button>}
    <p>Skill、App、项目说明与记忆的细分来源尚未记录，保留为未归属文本。本诊断不会修改提示词或停用扩展。</p>
  </div>
}
