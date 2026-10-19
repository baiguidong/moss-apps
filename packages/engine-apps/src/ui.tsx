import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createAppClient } from '@moss/app-sdk/ui'
import { FolderOpen, Plus, X, Download, Play, RefreshCw, Terminal, Clock3, CheckCircle2, AlertCircle } from 'lucide-react'
declare global { interface Window { mossApp?: any } }
export type Task = { id:string; input:any; source:string; status:string; createdAt:number; message:string; result?:any; argv?:string[]; warnings?:string; artifacts:Array<{name:string;kind:string;path:string;url:string}>; log?:string }
export type Option = {key:string;short?:string;label:string;value:boolean;optional?:boolean;description:string;default?:string;choices?:string[]}
export const labels:Record<string,string>={queued:'等待中',running:'运行中',succeeded:'已完成',failed:'失败',canceled:'已取消',interrupted:'已中断',partial:'部分完成'}
export const size=(n:number)=>n>=1024**3?`${(n/1024**3).toFixed(2)} GiB`:n>=1024**2?`${(n/1024**2).toFixed(1)} MiB`:`${Math.ceil((n||0)/1024)} KiB`
export function useEngineApp(){
  const client=useRef<ReturnType<typeof createAppClient>|null>(null), alive=useRef(true), refreshing=useRef(false)
  const [tasks,setTasks]=useState<Task[]>([]),[catalog,setCatalog]=useState<any>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState('')
  const refresh=useCallback(async()=>{if(!client.current||refreshing.current)return;refreshing.current=true;try{const result:any=await client.current.actions.invoke('workspace.get',{});if(alive.current){setTasks(result.tasks);if(result.registrationError)setError(result.registrationError)}}catch(e){if(alive.current)setError((e as Error).message)}finally{refreshing.current=false}},[])
  useEffect(()=>{
    alive.current=true
    if(!window.mossApp){setError('请在 Moss 中打开此 App');return}
    client.current=createAppClient(window.mossApp)
    const media=window.matchMedia('(prefers-color-scheme: dark)')
    const appearance=async()=>{const info=await window.mossApp.app.getInfo().catch(()=>null);if(alive.current)document.documentElement.dataset.theme=(info?.appearance?.themeMode==='dark'||info?.appearance?.themeMode==='system'&&media.matches)?'dark':'light'}
    void appearance();const off=window.mossApp.events?.on?.('appearance',appearance);media.addEventListener('change',appearance)
    void refresh();void client.current.actions.invoke('catalog.get',{}, {timeoutMs:300000}).then((value:any)=>{if(alive.current)setCatalog(value)}).catch((e:Error)=>{if(alive.current)setError(e.message)})
    const interval=setInterval(refresh,1200)
    return()=>{alive.current=false;clearInterval(interval);off?.();media.removeEventListener('change',appearance);client.current?.dispose()}
  },[refresh])
  const invoke=async(name:string,input:any={})=>{
    if(!client.current)return null
    setBusy(true);setError('');setNotice('')
    try{const result:any=await client.current.actions.invoke(name,input,{timeoutMs:300000});await refresh();return result}catch(e){setError((e as Error).message);return null}finally{setBusy(false)}
  }
  const start=async(input:any)=>{const task=await invoke('tasks.start',input);if(task)setSelected(task.id);return task}
  const prepare=async()=>{const value=await invoke('engine.prepare');if(value){setCatalog(value);setNotice('引擎已就绪')}}
  return {tasks,catalog,error,notice,busy,selected,setSelected,setError,setNotice,invoke,start,prepare,refresh,task:tasks.find(t=>t.id===selected)||tasks[0]}
}
export type EngineState=ReturnType<typeof useEngineApp>
// Moss owns the visible App identity; this shell starts with the work area.
export function AppShell({state,title,children}:{state:EngineState;title:string;children:ReactNode}){
 return <div className="engine-app"><h1 className="visually-hidden">{title}</h1>
 {state.error&&<div role="alert" className="notice error"><AlertCircle size={18}/><span>{state.error}</span><button disabled={state.busy} onClick={()=>void state.prepare()}>重新检查</button><button aria-label="关闭提示" onClick={()=>state.setError('')}><X size={16}/></button></div>}
 {state.notice&&<div role="status" className="notice"><CheckCircle2 size={18}/>{state.notice}</div>}
 <main data-app-primary>{children}</main><footer><span>本地处理 · Agent 与页面共享结果</span><span className="engine-status"><span>{state.catalog?'已就绪':'正在准备'}{state.catalog?.version?` · ${state.catalog.version}`:''}</span><button aria-label="检查引擎" title="重新检查本地引擎" disabled={state.busy} onClick={()=>void state.prepare()}><RefreshCw size={13}/>检查</button></span></footer></div>
}
export function Paths({state,values,onChange,kind='file',label='输入文件'}:{state:EngineState;values:string[];onChange:(values:string[])=>void;kind?:'file'|'directory';label?:string}){
 const pick=async()=>{const result=await state.invoke('paths.pick',{kind,multiple:true});if(result?.paths)onChange([...new Set([...values.filter(Boolean),...result.paths])])}
 return <section className="path-section"><div className="section-heading"><h2>{label}</h2><button disabled={state.busy} onClick={()=>void pick()}><FolderOpen size={16}/>选择{kind==='directory'?'目录':'文件'}</button></div>
 {!values.length&&<button className="drop-zone" onClick={()=>void pick()}><FolderOpen size={26}/><strong>选择本地{kind==='directory'?'目录':'文档'}</strong><span>或添加绝对路径；参数中的空格会保留</span></button>}
 {values.map((value,index)=><div className="path-row" key={index}><input aria-label={`${label} ${index+1}`} value={value} onChange={e=>onChange(values.map((v,i)=>i===index?e.target.value:v))} placeholder="/Users/…"/><button aria-label={`移除路径 ${index+1}`} onClick={()=>onChange(values.filter((_,i)=>i!==index))}><X size={15}/></button></div>)}
 <button className="text-button" onClick={()=>onChange([...values,''])}><Plus size={14}/>添加路径</button></section>
}
const repeated=new Set(['excluded-directories','reference-directories','excluded-items','metadata','metadata-file','variable','bibliography','css','include-in-header','include-before-body','include-after-body','lua-filter','filter','epub-embed-font','pdf-engine-opt','variable-json','request-header','typst-input','syntax-definition','defaults'])
export function Options({options,values,onChange,search=true}:{options:Option[];values:Record<string,any>;onChange:(v:Record<string,any>)=>void;search?:boolean}){
 const [query,setQuery]=useState('')
 return <div>{search&&<input className="option-search" aria-label="筛选参数" placeholder="查找参数…" value={query} onChange={e=>setQuery(e.target.value)}/>}
 <div className="option-grid">{options.filter(o=>`${o.label} ${o.key} ${o.description}`.toLowerCase().includes(query.toLowerCase())).map(o=><label className={o.value||o.optional?'field':'check-field'} key={o.key} title={o.description}>
 {o.value?<><span>{o.label}</span>{repeated.has(o.key)?<textarea aria-label={o.label} rows={2} value={Array.isArray(values[o.key])?values[o.key].join('\n'):values[o.key]||''} placeholder="每行一项" onChange={e=>onChange({...values,[o.key]:e.target.value.split('\n').filter(Boolean)})}/>:o.choices?.length?<select aria-label={o.label} value={values[o.key]||''} onChange={e=>onChange({...values,[o.key]:e.target.value})}><option value="">上游默认值</option>{o.choices.map(v=><option key={v}>{v}</option>)}</select>:<input aria-label={o.label} value={values[o.key]===true?'':values[o.key]??''} placeholder={o.default||'使用默认值'} onChange={e=>onChange({...values,[o.key]:e.target.value})}/>}{o.optional&&<span className="optional-switch"><input type="checkbox" checked={values[o.key]===true} onChange={e=>onChange({...values,[o.key]:e.target.checked?true:''})}/>启用默认值</span>}<small>{o.description.slice(0,110)}</small></>:o.optional?<><span>{o.label}</span><select aria-label={o.label} value={values[o.key]===undefined?'':String(values[o.key])} onChange={e=>onChange({...values,[o.key]:e.target.value===''?undefined:e.target.value==='true'})}><option value="">上游默认值</option><option value="true">启用</option><option value="false">关闭</option></select></>:<><input type="checkbox" checked={values[o.key]===true} onChange={e=>onChange({...values,[o.key]:e.target.checked})}/><span>{o.label}<small>{o.description.slice(0,90)}</small></span></>}
 </label>)}</div></div>
}
export function Advanced({args,onChange}:{args:string[];onChange:(v:string[])=>void}){
 return <details className="advanced"><summary><Terminal size={15}/>高级参数</summary><p className="muted">每行是一个完整参数，不添加 shell 引号。错误信息和实际参数会保存在任务中，供 Agent 调整。</p><textarea aria-label="高级参数" rows={4} value={args.join('\n')} onChange={e=>onChange(e.target.value.split('\n'))} placeholder={'--option\nvalue with spaces'}/></details>
}
export function RunButton({state,onClick,label='开始处理',disabled=false}:{state:EngineState;onClick:()=>void;label?:string;disabled?:boolean}){return <button className="primary run" disabled={state.busy||disabled} onClick={onClick}><Play size={16}/>{label}</button>}
export function TaskHistory({state,onRestore}:{state:EngineState;onRestore?:(input:any)=>void}){
 return <section className="history"><div className="section-heading"><h2><Clock3 size={17}/>任务记录 <small>{state.tasks.length}</small></h2><button aria-label="刷新任务" onClick={()=>void state.refresh()}><RefreshCw size={14}/></button></div>
 {!state.tasks.length&&<p className="muted">运行后的结果和错误记录会保存在这里。</p>}
 {state.tasks.map(task=><div className={`task-row ${state.task?.id===task.id?'selected':''}`} key={task.id}><button className="task-title" onClick={()=>state.setSelected(task.id)}><strong>{task.input.command||task.input.tool||task.input.to||'查询'}</strong><small>{new Date(task.createdAt).toLocaleString()} · {task.source==='agent-skill'?'Agent skill':task.source==='agent-tool'?'Agent tool':'页面'}</small><span>{task.message.slice(0,140)}</span></button><span className={`badge ${task.status}`}>{labels[task.status]||task.status}</span>
 {['running','queued'].includes(task.status)?<button onClick={()=>void state.invoke('tasks.cancel',{id:task.id})}>取消</button>:onRestore&&<button onClick={()=>onRestore(task.input)}>调整参数</button>}</div>)}
 </section>
}
export function TaskDetails({state,children}:{state:EngineState;children?:ReactNode}){
 const [tab,setTab]=useState('result'),[log,setLog]=useState('')
 useEffect(()=>{setLog('')},[state.task?.id])
 if(!state.task)return <section className="empty-result"><CheckCircle2 size={36}/><h2>结果将在这里显示</h2><p>完成任务后直接查看、比较和导出。Agent 发起的任务也会出现在这里。</p></section>
 const task=state.task
 const openLog=async()=>{setTab('log');const r=await state.invoke('tasks.get',{id:task.id});if(r)setLog(r.log||r.message)}
 return <section className="result-panel"><div className="section-heading"><h2>任务结果</h2><span className={`badge ${task.status}`}>{labels[task.status]}</span></div><p className="task-message">{task.message}</p>
 <div className="tabs"><button className={tab==='result'?'active':''} onClick={()=>setTab('result')}>结果</button><button className={tab==='input'?'active':''} onClick={()=>setTab('input')}>参数记录</button><button className={tab==='log'?'active':''} onClick={()=>void openLog()}>运行日志</button></div>
 {tab==='result'?children||<Artifacts state={state}/>:tab==='input'?<pre>{JSON.stringify({input:task.input,argv:task.argv},null,2)}</pre>:<pre>{log||'暂无日志'}</pre>}</section>
}
export function Artifacts({state}:{state:EngineState}){
 const task=state.task,[selected,setSelected]=useState(0),[text,setText]=useState('')
 useEffect(()=>{setSelected(0);setText('')},[task?.id,task?.artifacts.length])
 const file=task?.artifacts[selected]
 const preview=file?.kind==='document'&&task?.artifacts[selected+1]?.kind==='html'?task.artifacts[selected+1]:file
 useEffect(()=>{let active=true;if(task&&file&&['text','json'].includes(file.kind))void state.invoke('artifacts.read',{id:task.id,index:selected}).then(value=>{if(active&&value)setText(value.text)});return()=>{active=false}},[task?.id,selected,file?.path])
 if(!task||!file)return <p className="muted">任务结束后可查看生成的文件。</p>
 return <div><div className="artifact-toolbar"><select aria-label="结果文件" value={selected} onChange={e=>setSelected(Number(e.target.value))}>{task.artifacts.map((f,i)=><option key={i} value={i}>{f.name}</option>)}</select><button onClick={async()=>{const result=await state.invoke('artifacts.export',{id:task.id,index:selected});if(result?.path)state.setNotice('已导出到 '+result.path)}}><Download size={15}/>导出结果</button></div>
 {preview?.kind==='html'?<><p className="muted">内容预览 · 与 Office 的分页排版可能不同</p><iframe title="文档内容预览" sandbox="" src={preview.url}/></>:file.kind==='image'?<img className="artifact-image" alt={file.name} src={file.url}/>:file.kind==='pdf'?<iframe title="PDF 预览" src={file.url}/>:['text','json'].includes(file.kind)?<pre className="artifact-text">{text}</pre>:<p className="muted">文件已生成，可导出使用。选择“内容预览”可在这里阅读。</p>}</div>
}
