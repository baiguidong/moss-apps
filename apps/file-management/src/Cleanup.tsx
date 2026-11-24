import { useEffect, useState, type ReactNode } from 'react'
import { ScanLine } from 'lucide-react'
import { type EngineState, type Option, type Task } from '@moss/engine-apps/ui'
import { DirectoryField, History } from './workspace'
import CleanupResults from './CleanupResults'
import CleanupSettings, { type OptionsMap } from './CleanupSettings'

type Command = { id: string; title: string; options: Option[]; subcommands?: Command[] }

const descriptions: Record<string, string> = {
  dup: '按文件内容查找完全相同的副本。',
  big: '查看哪些文件占用空间最多。',
  image: '找出画面相近的图片，可并排预览。',
  music: '找出重复的音频文件。',
  video: '按画面内容查找相似的视频。',
  'video-optimizer': '检查可转码或裁掉黑边的视频。',
  'empty-folders': '找到没有内容的目录。',
  'empty-files': '找到大小为 0 的文件。',
  temp: '查找常见的临时文件。',
  symlinks: '找到指向已不存在位置的链接。',
  broken: '查找内容可能损坏的文件。',
  ext: '检查文件扩展名是否与内容一致。',
  'bad-names': '检查可能引起兼容问题的文件名。',
  'exif-remover': '检查图片附带的拍摄信息。',
}
const categoryGroups = [
  ['常用清理', ['dup', 'big', 'temp', 'empty-files', 'empty-folders']],
  ['图片与音视频', ['image', 'music', 'video', 'video-optimizer', 'exif-remover']],
  ['文件检查', ['symlinks', 'broken', 'ext', 'bad-names']],
] as const
export default function Cleanup({ state, historyAction }: { state: EngineState; historyAction: ReactNode }) {
  const [command, setCommand] = useState('dup')
  const [paths, setPaths] = useState<string[]>([])
  const [options, setOptions] = useState<OptionsMap>({ 'minimal-file-size': '1' })
  const [subcommand, setSubcommand] = useState('transcode')
  const [suboptions, setSuboptions] = useState<OptionsMap>({})
  const [extra, setExtra] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [videoStatus, setVideoStatus] = useState<{ available: boolean; message: string } | null>(null)
  const video = command === 'video' || command === 'video-optimizer'
  const commands: Command[] = state.catalog?.commands || []
  const title = (id: string) => commands.find(item => item.id === id)?.title || '文件扫描'
  const current = commands.find(item => item.id === command)
  const sub = current?.subcommands?.find(item => item.id === subcommand)

  useEffect(() => {
    const actions = window.mossApp?.actions
    if (!video || !actions) return
    let current = 0, disposed = false
    const check = async () => {
      const request = ++current
      try {
        const response = await actions.invoke('cleanup.video.status', {})
        if (!disposed && request === current) setVideoStatus(response.ok ? response.result : { available: false, message: response.error.message })
      } catch (error) {
        if (!disposed && request === current) setVideoStatus({ available: false, message: (error as Error).message })
      }
    }
    void check()
    window.addEventListener('focus', check)
    return () => { disposed = true; window.removeEventListener('focus', check) }
  }, [video])

  const changeCommand = (id: string) => {
    if (!video) setVideoStatus(null)
    setCommand(id)
    setOptions(id === 'dup' ? { 'minimal-file-size': '1' } : {})
    setSuboptions({})
    setExtra('')
    setConfirmed(false)
  }
  const reuse = (input: Task['input']) => {
    setCommand(input.command)
    setPaths(input.paths || [])
    setOptions(input.options || {})
    setSubcommand(input.subcommand || 'transcode')
    setSuboptions(input.suboptions || {})
    setExtra((input.extraArgs || []).join('\n'))
    setConfirmed(false)
    document.getElementById('cleanup-form')?.scrollIntoView({ block: 'start' })
  }
  const start = async () => {
    const task = await state.invoke('cleanup.start', {
      command, paths: paths.filter(Boolean),
      options: Object.fromEntries(Object.entries(options).map(([key, value]) => [key, Array.isArray(value) ? value.filter(Boolean) : value])),
      subcommand: current?.subcommands ? subcommand : undefined,
      suboptions, extraArgs: extra.split('\n').filter(Boolean), confirmChanges: confirmed,
    })
    if (task) state.setSelected(task.id)
  }
  return <div className="fm-workspace fm-cleanup-workspace">
    <div className="fm-column">
      <section className="fm-panel" id="cleanup-form">
        <h2><ScanLine size={19} />扫描文件</h2>
        <label className="fm-field">
          <span>扫描类型</span>
          <select aria-label="扫描类型" value={command} disabled={!commands.length} onChange={event => changeCommand(event.target.value)}>
            {!commands.length && <option value="dup">正在加载扫描类型…</option>}
            {categoryGroups.map(([label, ids]) => <optgroup key={label} label={label}>
              {ids.filter(id => commands.some(item => item.id === id)).map(id => <option key={id} value={id}>{title(id)}</option>)}
            </optgroup>)}
          </select>
          {current && <small>{descriptions[command]}</small>}
        </label>
        <DirectoryField state={state} label="扫描目录" values={paths} multiple onChange={setPaths} />
        {current?.subcommands && <label className="fm-field"><span>优化方式</span>
          <select value={subcommand} onChange={event => { setSubcommand(event.target.value); setSuboptions({}) }}>
            {current.subcommands.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
          </select>
        </label>}
        {video && !videoStatus?.available && <p className="fm-callout" role="status">{videoStatus?.message || '正在检查多媒体工坊…'}</p>}
        <div className="fm-scan-actions">
          <button className="primary" type="button" disabled={state.busy || !paths.some(Boolean) || !current || (video && !videoStatus?.available)} onClick={() => void start()}>
            <ScanLine size={17} />{confirmed ? '执行所选操作' : '开始扫描'}
          </button>
          {current && <CleanupSettings key={`${command}/${subcommand}`} state={state} options={options} definitions={current.options}
            suboptions={suboptions} subDefinitions={sub?.options || []} extra={extra} confirmed={confirmed}
            setOptions={setOptions} setSuboptions={setSuboptions} setExtra={setExtra} setConfirmed={setConfirmed} />}
        </div>
      </section>
      <History state={state} label={item => item.input.followUp?.operation === 'trash' ? '移入废纸篓' : item.input.followUp ? `处理 · ${title(item.input.command)}` : title(item.input.command)}
        action={historyAction} />
    </div>
    <CleanupResults key={state.task?.id} state={state} title={title(state.task?.input.command)} onReuse={reuse} />
  </div>
}
