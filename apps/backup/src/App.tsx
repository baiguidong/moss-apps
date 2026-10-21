import { useEffect, useState } from 'react'
import { AppShell, Artifacts, Paths, TaskDetails, TaskHistory, size, useEngineApp } from '@moss/engine-apps/ui'

export default function App() {
  const state = useEngineApp()
  const [repo, setRepo] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [target, setTarget] = useState('')
  const [snapshot, setSnapshot] = useState('')
  const [password, setPassword] = useState('')
  const [configured, setConfigured] = useState(false)
  const [instanceId, setInstanceId] = useState('')
  useEffect(() => {
    if (!window.mossApp) return
    void window.mossApp.instances.list().then((items: any[]) => {
      const item = items[0]
      if (item) { setInstanceId(item.id); setConfigured(Boolean(item.secretRefs?.password)) }
    }).catch((error: Error) => state.setError(error.message))
  }, [])
  const pick = async (set: (value: string) => void) => {
    const result = await state.invoke('paths.pick', { kind: 'directory', multiple: false })
    if (result?.paths?.[0]) set(result.paths[0])
  }
  const savePassword = async () => {
    if (!password || !instanceId) return
    try {
      await window.mossApp!.instances.update(instanceId, { secrets: { password } })
      setConfigured(true); setPassword(''); state.setNotice('备份密码已保存在 Moss 凭据库')
      await state.refresh()
    } catch (error) { state.setError((error as Error).message) }
  }
  const start = (command: string) => void state.start({ command, repo, paths: sources.filter(Boolean), snapshot, target })
  const restore = (input: any) => {
    setRepo(input.repo || ''); setSources(input.paths || []); setSnapshot(input.snapshot || ''); setTarget(input.target || '')
  }
  const task = state.task, snapshots = task?.result?.snapshots, entries = task?.result?.entries
  const passwordEditor = <div className="inline-fields">
    <label className="field"><span>{configured ? '新的已保存密码' : '设置备份密码'}</span><input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder={configured ? '填写后可更新' : '用于加密备份库'} /></label>
    <button style={{ alignSelf: 'end' }} disabled={!password || !instanceId} onClick={() => void savePassword()}>保存密码</button>
  </div>
  return <AppShell state={state} title="备份与恢复"><div className="two-column">
    <section className="card">
      <div className="section-heading"><h2>备份库</h2><button onClick={() => void pick(setRepo)}>选择目录</button></div>
      <input aria-label="备份库路径" value={repo} onChange={event => setRepo(event.target.value)} placeholder="已有备份库或用于初始化的空目录" style={{ width: '100%' }} />
      <div className="workspace-note">首次使用空目录时点击“初始化”；之后可备份和浏览快照。</div>
      {configured ? <details className="advanced"><summary>更新的已保存密码</summary>{passwordEditor}</details> : passwordEditor}
      <div className="compact-actions"><button disabled={!configured || !repo} onClick={() => start('init')}>初始化</button><button disabled={!configured || !repo} onClick={() => start('snapshots')}>查看快照</button><button disabled={!configured || !repo} onClick={() => start('check')}>校验备份库</button></div>
      <div className="advanced"><Paths state={state} values={sources} onChange={setSources} kind="directory" label="需要备份的目录" /></div>
      <button className="primary run" disabled={!configured || !repo || !sources.some(Boolean) || state.busy} onClick={() => start('backup')}>开始备份</button>
      <div className="advanced"><div className="section-heading"><h2>浏览与恢复</h2></div>
        <label className="field"><span>快照 ID</span><input aria-label="快照 ID" value={snapshot} onChange={event => setSnapshot(event.target.value)} placeholder="从右侧快照列表选择或输入 ID" /></label>
        <div className="compact-actions"><button disabled={!snapshot || !repo} onClick={() => start('ls')}>查看文件</button><button disabled={!target || !snapshot || !repo} onClick={() => start('restore')}>恢复到目标目录</button></div>
        <p className="workspace-note">恢复时可能覆盖目标目录中的同名文件，请先检查目标位置。</p>
        <div className="section-heading" style={{ marginTop: 12 }}><h2>恢复目标</h2><button onClick={() => void pick(setTarget)}>选择目录</button></div>
        <input aria-label="恢复目标目录" value={target} onChange={event => setTarget(event.target.value)} placeholder="选择一个已有目录" style={{ width: '100%' }} />
      </div>
    </section>
    <div className="workspace-body"><TaskDetails state={state}>
      {Array.isArray(snapshots) && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>快照</th><th>时间</th><th>来源</th><th></th></tr></thead><tbody>{snapshots.map((item: any) => <tr key={item.id}><td>{item.short_id || item.id}</td><td>{item.time}</td><td title={(item.paths || []).join(', ')}>{(item.paths || []).map((value: string) => value.split(/[\\/]/).filter(Boolean).at(-1)).join(', ')}</td><td><button onClick={() => setSnapshot(item.id)}>选择</button></td></tr>)}</tbody></table></div>}
      {Array.isArray(entries) && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>文件</th><th>类型</th><th>大小</th></tr></thead><tbody>{entries.map((item: any, index: number) => <tr key={index}><td>{item.path || item.name || ''}</td><td>{item.type || ''}</td><td>{item.size ?? ''}</td></tr>)}</tbody></table></div>}
      {task?.result?.summary && <div className="stats"><div className="stat"><strong>{task.result.summary.total_files_processed || 0}</strong><small>已处理文件</small></div><div className="stat"><strong>{size(task.result.summary.total_bytes_processed || 0)}</strong><small>源数据</small></div><div className="stat"><strong>{size(task.result.summary.data_added_packed || 0)}</strong><small>新增备份</small></div></div>}
      <details className="advanced"><summary>原始输出与导出</summary><Artifacts state={state} /></details>
    </TaskDetails><TaskHistory state={state} onRestore={restore} /></div>
  </div></AppShell>
}
