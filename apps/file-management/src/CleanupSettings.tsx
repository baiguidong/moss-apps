import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, FolderOpen, SlidersHorizontal, X } from 'lucide-react'
import { Options, type EngineState, type Option } from '@moss/engine-apps/ui'

export type OptionsMap = Record<string, string | boolean | string[]>

const managed = new Set(['directories', 'file-to-save', 'compact-file-to-save', 'pretty-file-to-save', 'help', 'ignore-error-code-on-found'])
const scopeKeys = ['excluded-directories', 'excluded-items', 'allowed-extensions', 'excluded-extensions', 'not-recursive', 'exclude-other-filesystems']
const matchKeys = ['minimal-file-size', 'maximal-file-size', 'search-method', 'reference-directories', 'allow-hard-links']
const engineKeys = ['thread-number', 'disable-cache', 'hash-type']
const writeNames: Record<string, string> = {
  'delete-method': '清理策略', 'delete-files': '处理全部匹配项', 'dry-run': '仅预演', 'move-to-trash': '移入废纸篓',
  'fix-videos': '生成优化视频', 'overwrite-original': '覆盖原视频', 'fix-exif': '移除拍摄信息',
  'override-file': '覆盖原文件', 'fix-names': '修正文件名', 'fix-extensions': '修正扩展名',
}
const deleteChoices = [
  ['NONE', '仅扫描'], ['AEN', '保留最新'], ['AEO', '保留最早'], ['ON', '只清理最新'], ['OO', '只清理最早'],
  ['AEB', '保留最大'], ['AES', '保留最小'], ['OB', '只清理最大'], ['OS', '只清理最小'], ['HARD', '替换为硬链接'],
] as const
const matchChoices = [['HASH', '文件内容（推荐）'], ['NAME', '文件名'], ['SIZE', '文件大小'], ['SIZE_NAME', '文件名和大小']] as const
const sizePresets = [['1', '1 字节'], ['1024', '1 KiB'], ['1048576', '1 MiB'], ['10485760', '10 MiB'], ['104857600', '100 MiB'], ['1073741824', '1 GiB']] as const
const unlimited = '18446744073709551615'

function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="fm-setting-row">
    <div><strong>{label}</strong>{hint && <small>{hint}</small>}</div>
    <div className="fm-setting-control">{children}</div>
  </div>
}

function TextList({ state, label, value, onChange, directories = false }: {
  state: EngineState; label: string; value: OptionsMap[string] | undefined; onChange: (value: string[]) => void; directories?: boolean
}) {
  const values = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []
  const pick = async () => {
    const picked = await state.invoke('paths.pick', { kind: 'directory', multiple: true }, { refreshWorkspace: false })
    if (picked?.paths?.length) onChange([...new Set([...values.filter(Boolean), ...picked.paths])])
  }
  return <div className="fm-setting-list">
    <textarea aria-label={label} rows={2} placeholder={directories ? '输入绝对路径，每行一个' : '*.tmp'} value={values.join('\n')}
      onChange={event => onChange(event.target.value.split('\n'))} />
    {directories && <button type="button" className="fm-setting-secondary" disabled={state.busy} onClick={() => void pick()}>
      <FolderOpen size={15} />选择文件夹
    </button>}
  </div>
}

function SizeSetting({ label, value, onChange, max }: { label: string; value: string; onChange: (value: string) => void; max: boolean }) {
  const [editing, setEditing] = useState(false)
  const custom = editing || Boolean(value && value !== unlimited && !sizePresets.some(([bytes]) => bytes === value))
  const selected = custom ? 'custom' : value === unlimited ? '' : value
  return <div className="fm-setting-list">
    <select aria-label={label} value={selected} onChange={event => {
      const next = event.target.value
      setEditing(next === 'custom')
      if (next !== 'custom') onChange(next)
    }}>
      <option value="">{max ? '不限' : '使用扫描默认值'}</option>
      {sizePresets.map(([bytes, name]) => <option key={bytes} value={bytes}>{name}</option>)}
      <option value="custom">自定义字节数</option>
    </select>
    {custom && <input aria-label={`${label}（字节）`} inputMode="numeric" placeholder="输入字节数"
      value={value === unlimited ? '' : value} onChange={event => {
        if (/^\d*$/.test(event.target.value)) onChange(event.target.value)
      }} />}
  </div>
}

const panels = [['scope', '范围与筛选'], ['match', '匹配条件'], ['engine', '引擎与命令行']] as const
type Panel = typeof panels[number][0]

export default function CleanupSettings({ state, options, definitions, suboptions, subDefinitions, extra, confirmed, setOptions, setSuboptions, setExtra, setConfirmed }: {
  state: EngineState; options: OptionsMap; definitions: Option[]; suboptions: OptionsMap; subDefinitions: Option[]
  extra: string; confirmed: boolean; setOptions: (value: OptionsMap) => void; setSuboptions: (value: OptionsMap) => void
  setExtra: (value: string) => void; setConfirmed: (value: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [panel, setPanel] = useState<Panel>('scope')
  const keys = new Set(definitions.map(option => option.key))
  const text = (key: string) => {
    const value = options[key]
    return typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : ''
  }
  const set = (key: string, value: OptionsMap[string]) => setOptions({ ...options, [key]: value })
  const choices = (key: string, label: string, items: readonly (readonly [string, string])[], fallback: string) => {
    const value = text(key) || fallback
    return <select aria-label={label} value={value} onChange={event => set(key, event.target.value)}>
      {items.map(([code, title]) => <option key={code} value={code}>{title}</option>)}
      {!items.some(([code]) => code === value) && <option value={value}>{value}</option>}
    </select>
  }
  const toggle = (key: string, label: string, hint: string) => keys.has(key) && <SettingsRow label={label} hint={hint}>
    <label className="fm-setting-switch">
      <input type="checkbox" role="switch" aria-label={label} checked={options[key] === true} onChange={event => set(key, event.target.checked)} />
      <span aria-hidden="true" />
    </label>
  </SettingsRow>
  const remaining = definitions.filter(option => !managed.has(option.key) && !scopeKeys.includes(option.key) && !matchKeys.includes(option.key) &&
    !engineKeys.includes(option.key) && !writeNames[option.key] && /[\u3400-\u9fff]/.test(option.label))
    .map(option => ({ ...option, description: '' }))
  const cliOptions = (items: Option[]) => items.filter(option => writeNames[option.key] && option.key !== 'delete-method')
    .map(option => ({ ...option, label: writeNames[option.key], description: '' }))
  const matchControls = remaining.length > 0 || matchKeys.some(key => keys.has(key))
  return <>
    <button type="button" className="fm-scan-settings-trigger" onClick={() => { setPanel('scope'); dialog.current?.showModal() }}>
      <SlidersHorizontal size={16} />高级设置
    </button>
    <dialog ref={dialog} className="fm-dialog fm-settings-dialog" aria-labelledby="fm-settings-title">
      <div className="fm-settings-head">
        <h2 id="fm-settings-title"><SlidersHorizontal size={19} />扫描设置</h2>
        <button type="button" className="fm-icon-button" aria-label="关闭扫描设置" onClick={() => dialog.current?.close()}><X size={17} /></button>
      </div>
      <div className="fm-segment fm-settings-tabs" aria-label="设置类别">
        {panels.map(([id, label]) => <button key={id} type="button" aria-pressed={panel === id} onClick={() => setPanel(id)}>{label}</button>)}
      </div>
      <div className="fm-settings-content">
        {panel === 'scope' && <div className="fm-settings-group">
          {keys.has('excluded-directories') && <SettingsRow label="排除文件夹" hint="跳过这些文件夹及其子目录。">
            <TextList state={state} label="排除文件夹" value={options['excluded-directories']} directories onChange={values => set('excluded-directories', values)} />
          </SettingsRow>}
          {keys.has('allowed-extensions') && <SettingsRow label="只查指定文件类型" hint="用逗号分隔扩展名，留空时查找全部类型。">
            <input aria-label="只查指定文件类型" placeholder="jpg, png, pdf" value={text('allowed-extensions')} onChange={event => set('allowed-extensions', event.target.value)} />
          </SettingsRow>}
          {keys.has('excluded-extensions') && <SettingsRow label="跳过指定文件类型">
            <input aria-label="跳过指定文件类型" placeholder="tmp, log" value={text('excluded-extensions')} onChange={event => set('excluded-extensions', event.target.value)} />
          </SettingsRow>}
          {keys.has('excluded-items') && <SettingsRow label="按规则排除" hint="每行一条。可使用 * 匹配文件名或路径。">
            <TextList state={state} label="按规则排除" value={options['excluded-items']} onChange={values => set('excluded-items', values)} />
          </SettingsRow>}
          {toggle('not-recursive', '只扫描当前层', '跳过下一级文件夹。')}
          {toggle('exclude-other-filesystems', '限制在同一文件系统', '跳过挂载在扫描目录下的其他磁盘。')}
        </div>}
        {panel === 'match' && <div className="fm-settings-group">
          {keys.has('search-method') && <SettingsRow label="重复文件比较方式" hint="按文件内容比较可以识别名称不同的副本。">
            {choices('search-method', '重复文件比较方式', matchChoices, 'HASH')}
          </SettingsRow>}
          {keys.has('minimal-file-size') && <SettingsRow label="最小文件大小">
            <SizeSetting label="最小文件大小" value={text('minimal-file-size')} onChange={value => set('minimal-file-size', value)} max={false} />
          </SettingsRow>}
          {keys.has('maximal-file-size') && <SettingsRow label="最大文件大小">
            <SizeSetting label="最大文件大小" value={text('maximal-file-size')} onChange={value => set('maximal-file-size', value)} max />
          </SettingsRow>}
          {keys.has('reference-directories') && <SettingsRow label="参考文件夹" hint="将这里的文件用作匹配参照。">
            <TextList state={state} label="参考文件夹" value={options['reference-directories']} directories onChange={values => set('reference-directories', values)} />
          </SettingsRow>}
          {toggle('allow-hard-links', '将硬链接计为独立文件', '同一文件的多个硬链接可同时出现在结果中。')}
          {remaining.length > 0 && <div className="fm-settings-extra"><Options options={remaining} values={options} onChange={setOptions} search={false} /></div>}
          {!matchControls && <p className="fm-muted fm-settings-extra">这个扫描类型使用固定的匹配条件。</p>}
        </div>}
        {panel === 'engine' && <>
          <div className="fm-settings-group">
            {keys.has('thread-number') && <SettingsRow label="并行扫描数" hint="留空由系统自动选择。">
              <input aria-label="并行扫描数" inputMode="numeric" placeholder="自动" value={text('thread-number') === '0' ? '' : text('thread-number')}
                onChange={event => { if (/^\d*$/.test(event.target.value)) set('thread-number', event.target.value) }} />
            </SettingsRow>}
            {keys.has('hash-type') && <SettingsRow label="哈希算法">
              {choices('hash-type', '哈希算法', [['BLAKE3', 'BLAKE3（推荐）'], ['CRC32', 'CRC32'], ['XXH3', 'XXH3']], 'BLAKE3')}
            </SettingsRow>}
            {toggle('disable-cache', '禁用扫描缓存', '重新计算以前扫描过的文件。')}
          </div>
          <details className="fm-settings-cli">
            <summary><ChevronDown size={15} />命令行与批处理</summary>
            <div className="fm-settings-group">
              {keys.has('delete-method') && <SettingsRow label="批量清理策略" hint="可在结果页逐项选择要清理的文件。">
                {choices('delete-method', '批量清理策略', deleteChoices, 'NONE')}
              </SettingsRow>}
              <div className="fm-settings-extra">
                <Options options={cliOptions(definitions)} values={options} onChange={setOptions} search={false} />
                <Options options={cliOptions(subDefinitions)} values={suboptions} onChange={setSuboptions} search={false} />
              </div>
              <SettingsRow label="额外参数" hint="每行填写一个完整参数或参数值。">
                <textarea aria-label="额外参数" rows={3} value={extra} onChange={event => setExtra(event.target.value)} />
              </SettingsRow>
              <SettingsRow label="允许本次批处理修改文件">
                <label className="fm-setting-switch"><input type="checkbox" role="switch" aria-label="允许本次批处理修改文件"
                  checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span aria-hidden="true" /></label>
              </SettingsRow>
            </div>
          </details>
        </>}
      </div>
      <div className="fm-settings-foot"><button type="button" className="primary" onClick={() => dialog.current?.close()}>完成</button></div>
    </dialog>
  </>
}
