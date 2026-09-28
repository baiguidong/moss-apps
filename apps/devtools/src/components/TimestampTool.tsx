import { useState } from 'react'
import type { TimestampInput, TimestampResult, TimeZone } from '../contracts'
import { invoke } from '../lib/host'
import { useOperation } from '../lib/operation'
import { CopyButton, ErrorMessage, ToolHeader } from './shared'
export function TimestampTool() {
  const [direction, setDirection] = useState<TimestampInput['direction']>('timestamp')
  const [input, setInput] = useState(''), [unit, setUnit] = useState<TimestampInput['unit']>('auto'), [timezone, setTimezone] = useState<TimeZone>('+08:00')
  const task = useOperation<TimestampResult>()
  function convert(value = input, type = direction, selectedUnit = unit) { void task.run(() => invoke('timestamp.convert', { direction: type, input: value, unit: selectedUnit, timezone })) }
  return <><ToolHeader title="时间戳转换" description="在时间戳与日期之间转换，精确到毫秒。"><button onClick={() => { task.clear(); setInput(''); }}>清空</button></ToolHeader>
    <div className="segmented" aria-label="转换方向">{(['timestamp', 'date'] as const).map(value => <button key={value} aria-pressed={direction === value} onClick={() => { task.clear(); setDirection(value); setInput('') }}>{value === 'timestamp' ? '时间戳 → 日期' : '日期 → 时间戳'}</button>)}</div>
    <form className="time-form" onSubmit={e => { e.preventDefault(); convert() }}>
      <label className="field grow">{direction === 'timestamp' ? '时间戳' : '日期时间'}<input autoComplete="off" aria-label={direction === 'timestamp' ? '时间戳' : '日期时间'} value={input} onChange={e => { task.clear(); setInput(e.target.value) }} placeholder={direction === 'timestamp' ? '例如 1704067200 或 1704067200000' : '例如 2024-01-01 08:00:00.000'} /></label>
      {direction === 'timestamp' && <label className="field">单位<select value={unit} onChange={e => { task.clear(); setUnit(e.target.value as TimestampInput['unit']) }}><option value="auto">自动识别</option><option value="seconds">秒（s）</option><option value="milliseconds">毫秒（ms）</option></select></label>}
      <label className="field">时区<select value={timezone} onChange={e => { task.clear(); setTimezone(e.target.value as TimeZone) }}>{[['+08:00','中国时间 · UTC+08:00'],['local','本机时区'],['UTC','协调世界时 · UTC'],['+09:00','UTC+09:00'],['+01:00','UTC+01:00'],['-05:00','UTC−05:00'],['-08:00','UTC−08:00']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="time-actions"><button className="primary" disabled={!input.trim() || task.busy}>{task.busy ? '转换中…' : '转换'}</button><button type="button" className="bordered" onClick={() => { const now = String(Date.now()); setDirection('timestamp'); setUnit('milliseconds'); setInput(now); convert(now, 'timestamp', 'milliseconds') }}>当前时间</button></div>
    </form><ErrorMessage error={task.error} />
    <section className="time-results" aria-label="转换结果">{task.result ? <dl>{[['所选时区', `${task.result.date} (${task.result.timezone})`],['秒时间戳',task.result.seconds],['毫秒时间戳',task.result.milliseconds],['UTC / ISO 8601',task.result.utc]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd><code>{value}</code><CopyButton value={value!} label={`复制${label}`} /></dd></div>)}</dl> : <div className="empty"><p>转换结果会显示在这里</p><span>粘贴时间戳，或点「当前时间」快速开始。</span></div>}</section>
    <p className="hint">自动识别 10 位秒和 13 位毫秒；其他长度请手动选择。日期按所选时区解析，固定偏移时区不包含夏令时规则。</p>
  </>
}
