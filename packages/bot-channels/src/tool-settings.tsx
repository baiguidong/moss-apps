import { useState } from 'react'
import { Button, Checkbox, Input, Segmented } from 'antd'

export type ChannelTool = {
  id: string
  title: string
  source: 'built-in' | 'app'
  appId?: string
  appName?: string
  effect?: string
  aliases: string[]
  availableInChat: boolean
  enabledByDefault: boolean
}

export type AssistantOption = { value: string; label: string; tools?: string[] }

type GroupBy = 'function' | 'app'
type SelectionAction = 'select' | 'clear' | 'invert'

const builtInFunctions: Record<string, string[]> = {
  '读取与搜索': ['Read', 'Glob', 'Grep', 'LS', 'ToolSearch'],
  '文件编辑': ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  '网页与浏览': ['WebFetch', 'WebSearch', 'moss_browser_open'],
  '命令与任务': ['Bash', 'PowerShell', 'TodoWrite', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'CronCreate', 'CronDelete', 'CronList'],
  '成果与图片': ['moss_present', 'image_gen'],
  '连接器': ['connector_cli_setup', 'connector_mcp_authenticate'],
}

function groupTools(tools: ChannelTool[], groupBy: GroupBy) {
  const grouped = new Map<string, { label: string; tools: ChannelTool[] }>()
  for (const tool of tools) {
    const functionName = tool.source === 'app'
      ? tool.effect === 'read' ? '读取与搜索' : '创建与修改'
      : Object.keys(builtInFunctions).find(name => builtInFunctions[name].includes(tool.id)) ?? '其他内置工具'
    const label = groupBy === 'function' ? functionName : tool.source === 'built-in' ? '内置工具' : tool.appName || tool.appId || 'App 工具'
    const key = groupBy === 'app' ? tool.appId || label : label
    const group = grouped.get(key) ?? { label, tools: [] }
    group.tools.push(tool)
    grouped.set(key, group)
  }
  const groups = [...grouped].map(([key, group]) => ({ key, ...group }))
  if (groupBy === 'app') {
    return groups.sort((a, b) => (a.label !== '内置工具' ? 1 : 0) - (b.label !== '内置工具' ? 1 : 0) ||
      a.label.localeCompare(b.label, 'zh-CN'))
  }
  const functionOrder = [...Object.keys(builtInFunctions), '创建与修改', '其他内置工具']
  return groups.sort((a, b) => functionOrder.indexOf(a.label) - functionOrder.indexOf(b.label))
}

function namedEntries(items: unknown[] = []) {
  return items.filter((item): item is Record<string, unknown> & { id: string } =>
    typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string')
}

function names(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

export function channelCatalog(result: { agents?: unknown[]; tools?: unknown[] }) {
  return {
    assistants: namedEntries(result.agents).map(item => ({
      value: item.id,
      label: String(item.name || item.id),
      tools: names(item.tools),
    })),
    tools: namedEntries(result.tools).map((item): ChannelTool => ({
      id: item.id,
      title: String(item.title || item.name || item.id),
      source: item.source === 'app' ? 'app' : 'built-in',
      appId: typeof item.appId === 'string' ? item.appId : undefined,
      appName: typeof item.appName === 'string' ? item.appName : undefined,
      effect: typeof item.effect === 'string' ? item.effect : undefined,
      aliases: names(item.aliases) ?? [],
      availableInChat: item.availableInChat !== false,
      enabledByDefault: item.enabledByDefault !== false,
    })),
  }
}

export function toolsForAssistant(tools: ChannelTool[], assistant?: AssistantOption) {
  const selectors = assistant?.tools
  return tools.filter(tool => {
    if (!tool.availableInChat || !tool.enabledByDefault) return false
    if (!selectors || selectors.includes('*')) return true
    return [tool.id, ...tool.aliases].some(name => selectors.some(selector =>
      name === selector || selector.endsWith('*') && name.startsWith(selector.slice(0, -1))))
  })
}

function SelectionActions({ scope, selected, total, onAction }: {
  scope: string
  selected: number
  total: number
  onAction: (action: SelectionAction) => void
}) {
  return (
    <div className="toolBulkActions" role="group" aria-label={scope}>
      <Button size="small" disabled={selected === total} onClick={() => onAction('select')}>全选</Button>
      <Button size="small" disabled={selected === 0} onClick={() => onAction('clear')}>清空</Button>
      <Button size="small" disabled={total === 0} onClick={() => onAction('invert')}>反选</Button>
    </div>
  )
}

export function ToolList({ tools, value, onChange }: {
  tools: ChannelTool[]
  value?: string[]
  onChange?: (value: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<GroupBy>('function')
  const filter = search.trim().toLocaleLowerCase()
  const groups = groupTools(tools, groupBy).map(group => ({
    ...group,
    tools: group.label.toLocaleLowerCase().includes(filter) ? group.tools : group.tools.filter(tool =>
      [tool.title, tool.id, tool.appName ?? '', ...tool.aliases].some(name => name.toLocaleLowerCase().includes(filter))),
  })).filter(group => group.tools.length)
  const visibleIds = groups.flatMap(group => group.tools.map(tool => tool.id))
  const availableIds = new Set(tools.map(tool => tool.id))
  const selected = new Set(value ?? [])
  const unavailable = [...selected].filter(id => !availableIds.has(id))
  const selectedCount = (ids: string[]) => ids.filter(id => selected.has(id)).length
  const updateSelection = (ids: string[], action: SelectionAction) => {
    const next = new Set(selected)
    for (const id of ids) {
      if (action === 'clear' || (action === 'invert' && selected.has(id))) next.delete(id)
      else next.add(id)
    }
    onChange?.([...next])
  }
  return (
    <>
      <div className="toolListToolbar">
        <Input className="toolSearch" aria-label="搜索工具" placeholder="搜索工具"
          value={search} onChange={event => setSearch(event.target.value)} allowClear />
        <Segmented<GroupBy> aria-label="工具分组" value={groupBy} onChange={setGroupBy}
          options={[{ label: '按功能', value: 'function' }, { label: '按 App', value: 'app' }]} />
      </div>
      {(onChange || filter) && (
        <div className="toolSelectionBar">
          <div className="toolGroupTitle" role="status">
            <strong>{filter ? '搜索结果' : '全部工具'}</strong>
            <span className="toolCount">
              {onChange ? `已选 ${selectedCount(visibleIds)} / ${visibleIds.length}` : `${visibleIds.length} 项`}
            </span>
            {filter && onChange && <span className="toolCount">全部已选 {selected.size - unavailable.length} 项</span>}
          </div>
          {onChange && <SelectionActions scope={filter ? '批量操作搜索结果' : '批量操作全部工具'}
            selected={selectedCount(visibleIds)} total={visibleIds.length}
            onAction={action => updateSelection(visibleIds, action)} />}
        </div>
      )}
      <div className="toolList">
        {groups.map(group => {
          const ids = group.tools.map(tool => tool.id)
          const count = selectedCount(ids)
          return (
            <section className="toolGroup" key={group.key} aria-label={group.label}>
              <div className="toolGroupHeader">
                <div className="toolGroupTitle">
                  <h3>{group.label}</h3>
                  <span className="toolCount">{onChange ? `已选 ${count} / ${ids.length}` : `${ids.length} 项`}</span>
                </div>
                {onChange && <SelectionActions scope={`${group.label}批量操作`} selected={count} total={ids.length}
                  onAction={action => updateSelection(ids, action)} />}
              </div>
              <div className="toolGrid">
                {group.tools.map(tool => onChange
                  ? <Checkbox key={tool.id} value={tool.id} checked={selected.has(tool.id)}
                      onChange={event => updateSelection([tool.id], event.target.checked ? 'select' : 'clear')}>{tool.title}</Checkbox>
                  : <div className="toolName" key={tool.id}>{tool.title}</div>)}
              </div>
            </section>
          )
        })}
        {!visibleIds.length && <p className="toolEmpty">{filter ? '没有匹配的工具' : '当前没有可用的工具'}</p>}
        {unavailable.length > 0 && (
          <section className="toolGroup" aria-label="不可用工具">
            <div className="toolGroupHeader">
              <div className="toolGroupTitle">
                <h3>不可用工具</h3>
                <span className="toolCount">{unavailable.length} 项</span>
              </div>
              <Button size="small" onClick={() => updateSelection(unavailable, 'clear')}>全部移除</Button>
            </div>
            <div className="toolGrid">
              {unavailable.map(id => <Checkbox key={id} value={id} checked
                onChange={() => updateSelection([id], 'clear')}>{id}</Checkbox>)}
            </div>
          </section>
        )}
      </div>
    </>
  )
}
