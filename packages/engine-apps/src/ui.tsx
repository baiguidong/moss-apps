import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createAppClient } from '@moss/app-sdk/ui'
import { FolderOpen, Plus, X, Download, Play, RefreshCw, Terminal, Clock3, CheckCircle2, AlertCircle } from 'lucide-react'
declare global { interface Window { mossApp?: any } }
export type Task = { id:string; input:any; source:string; status:string; createdAt:number; message:string; result?:any; argv?:string[]; warnings?:string; artifacts:Array<{name:string;kind:string;path:string;url:string;urlError?:string;size?:number}>; log?:string }
export type Option = {key:string;short?:string;label:string;value:boolean;optional?:boolean;description:string;default?:string;choices?:string[]}
export const labels:Record<string,string>={queued:'等待中',running:'运行中',succeeded:'已完成',failed:'失败',canceled:'已取消',interrupted:'已中断',partial:'部分完成'}
const activeTaskStatuses = new Set(['queued', 'running'])
const ACTIVE_POLL_MS = 15_000
const EVENT_REFRESH_MS = 400
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
export const size=(n:number)=>n>=1024**3?`${(n/1024**3).toFixed(2)} GiB`:n>=1024**2?`${(n/1024**2).toFixed(1)} MiB`:`${Math.ceil((n||0)/1024)} KiB`
export function useEngineApp(){
  const client=useRef<ReturnType<typeof createAppClient>|null>(null), alive=useRef(true), loading=useRef<Promise<void>|null>(null), pending=useRef(false), pendingUrlRefresh=useRef(false)
  const [tasks,setTasks]=useState<Task[]>([]),[catalog,setCatalog]=useState<any>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState('')
  const [deferredUrls,setDeferredUrls]=useState(false),[detail,setDetail]=useState<Task|null>(null),[detailIssue,setDetailIssue]=useState<{id:string;message:string}|null>(null),[refreshVersion,setRefreshVersion]=useState(0)
  const [visible,setVisible]=useState(()=>typeof document==='undefined'||!document.hidden)
  const refresh=useCallback(async function refreshWorkspace(renewArtifactUrls=false){
    if(!client.current||!alive.current)return
    if(loading.current){pending.current=true;pendingUrlRefresh.current ||= renewArtifactUrls;await loading.current;return}
    const current=client.current
    const request=(async()=>{try{const result:any=await current.actions.invoke('workspace.get',{});if(alive.current&&client.current===current){setTasks(result.tasks);setDeferredUrls(result.artifactUrlsDeferred===true);if(renewArtifactUrls)setRefreshVersion(value=>value+1);if(result.registrationError)setError(result.registrationError)}}catch(e){if(alive.current&&client.current===current)setError((e as Error).message)}})()
    loading.current=request
    try{await request}finally{loading.current=null;if(pending.current&&alive.current){const renewPending=pendingUrlRefresh.current;pending.current=false;pendingUrlRefresh.current=false;if(!document.hidden)void refreshWorkspace(renewPending)}}
  },[])
  const readArtifact=useCallback((id:string,index:number)=>{
    if(!client.current) return Promise.reject(new Error('任务后台尚未就绪'))
    return client.current.actions.invoke<{text:string}>('artifacts.read',{id,index})
  },[])
  const getTask=useCallback((id:string,timeoutMs?:number)=>{
    if(!client.current) return Promise.reject(new Error('任务后台尚未就绪'))
    return client.current.actions.invoke<Task>('tasks.get',{id},timeoutMs?{timeoutMs}:undefined)
  },[])
  useEffect(()=>{
    alive.current=true
    if(!window.mossApp){setError('请在 Moss 中打开此 App');return}
    client.current=createAppClient(window.mossApp)
    const media=window.matchMedia('(prefers-color-scheme: dark)')
    const appearance=async()=>{const info=await window.mossApp.app.getInfo().catch(()=>null);if(alive.current)document.documentElement.dataset.theme=(info?.appearance?.themeMode==='dark'||info?.appearance?.themeMode==='system'&&media.matches)?'dark':'light'}
    void appearance();const offAppearance=window.mossApp.events?.on?.('appearance',appearance);media.addEventListener('change',appearance)
    if(!document.hidden)void refresh()
    void client.current.actions.invoke('catalog.get',{}, {timeoutMs:300000}).then((value:any)=>{if(alive.current)setCatalog(value)}).catch((e:Error)=>{if(alive.current)setError(e.message)})
    let eventTimer:ReturnType<typeof setTimeout>|null=null, renewOnEvent=false
    const scheduleRefresh=(renewUrls=false)=>{if(document.hidden)return;renewOnEvent ||= renewUrls;if(eventTimer)return;eventTimer=setTimeout(()=>{eventTimer=null;const renew=renewOnEvent;renewOnEvent=false;void refresh(renew)},EVENT_REFRESH_MS)}
    const onVisibility=()=>{setVisible(!document.hidden);if(document.hidden){if(eventTimer)clearTimeout(eventTimer);eventTimer=null;renewOnEvent=false}else scheduleRefresh(true)}
    const onFocus=()=>scheduleRefresh(true)
    const offChanged=client.current.events.on('workspace.changed',()=>scheduleRefresh())
    document.addEventListener('visibilitychange',onVisibility);window.addEventListener('focus',onFocus)
    return()=>{alive.current=false;pending.current=false;pendingUrlRefresh.current=false;if(eventTimer)clearTimeout(eventTimer);offChanged();offAppearance?.();document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('focus',onFocus);media.removeEventListener('change',appearance);client.current?.dispose();client.current=null}
  },[refresh])
  useEffect(()=>{if(!visible)return;const timer=setInterval(()=>{if(!document.hidden)void refresh()},ACTIVE_POLL_MS);return()=>clearInterval(timer)},[visible,refresh])
  const summary=tasks.find(task=>task.id===selected)||tasks[0]
  const artifactStamp=summary?.artifacts.map(file=>`${file.path}\0${file.kind}\0${file.name}`).join('\0')||''
  const completedStatus=summary&&!activeTaskStatuses.has(summary.status)?summary.status:''
  useEffect(()=>{
    if(!deferredUrls||!summary?.artifacts.length||!client.current){setDetail(null);setDetailIssue(null);return}
    const current=client.current,id=summary.id
    let canceled=false
    setDetailIssue(null)
    void getTask(id).then(task=>{
      if(!canceled&&alive.current&&client.current===current)setDetail(task)
    }).catch((reason:Error)=>{if(!canceled&&alive.current&&client.current===current)setDetailIssue({id,message:reason.message})})
    return()=>{canceled=true}
  },[deferredUrls,summary?.id,artifactStamp,completedStatus,refreshVersion,getTask])
  const invoke=async(name:string,input:any={})=>{
    if(!client.current)return null
    setBusy(true);setError('');setNotice('')
    try{const result:any=await client.current.actions.invoke(name,input,{timeoutMs:300000});await refresh();return result}catch(e){setError((e as Error).message);return null}finally{setBusy(false)}
  }
  const start=async(input:any)=>{const task=await invoke('tasks.start',input);if(task)setSelected(task.id);return task}
  const prepare=async()=>{const value=await invoke('engine.prepare');if(value){setCatalog(value);setNotice('引擎已就绪')}}
  const detailStamp=detail?.artifacts.map(file=>`${file.path}\0${file.kind}\0${file.name}`).join('\0')||''
  const matchingDetail=summary&&detail?.id===summary.id&&detailStamp===artifactStamp
  const task=matchingDetail
    ? {...detail,...summary,artifacts:detail.artifacts} : summary
  const artifactDetailsReady=!deferredUrls||!summary?.artifacts.length||Boolean(matchingDetail)
  const artifactDetailsError=detailIssue&&detailIssue.id===summary?.id?detailIssue.message:''
  return {tasks,catalog,error,notice,busy,selected,setSelected,setError,setNotice,invoke,start,prepare,refresh,readArtifact,getTask,task,deferredUrls,artifactDetailsReady,artifactDetailsError}
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
 return <section className="history"><div className="section-heading"><h2><Clock3 size={17}/>任务记录 <small>{state.tasks.length}</small></h2><button aria-label="刷新任务" onClick={()=>void state.refresh(true)}><RefreshCw size={14}/></button></div>
 {!state.tasks.length&&<p className="muted">运行后的结果和错误记录会保存在这里。</p>}
 {state.tasks.map(task=><div className={`task-row ${state.task?.id===task.id?'selected':''}`} key={task.id}><button className="task-title" onClick={()=>state.setSelected(task.id)}><strong>{task.input.command||task.input.mode||task.input.tool||task.input.to||'查询'}</strong><small>{new Date(task.createdAt).toLocaleString()} · {task.source==='agent-skill'?'Agent skill':task.source==='agent-tool'?'Agent tool':'页面'}</small><span>{task.message.slice(0,140)}</span></button><span className={`badge ${task.status}`}>{labels[task.status]||task.status}</span>
 {['running','queued'].includes(task.status)?<button onClick={()=>void state.invoke('tasks.cancel',{id:task.id})}>取消</button>:onRestore&&<button onClick={()=>onRestore(task.input)}>调整参数</button>}</div>)}
 </section>
}
export function TaskDetails({state,children}:{state:EngineState;children?:ReactNode}){
 const [tab,setTab]=useState('result'),[log,setLog]=useState<{taskId:string;text?:string;error?:string;loading?:boolean}|null>(null)
 const logRequest=useRef(0)
 useEffect(()=>{setTab('result');setLog(null)},[state.task?.id])
 if(!state.task)return <section className="empty-result"><CheckCircle2 size={36}/><h2>结果将在这里显示</h2><p>完成任务后直接查看、比较和导出。Agent 发起的任务也会出现在这里。</p></section>
 const task=state.task
 const openLog=async()=>{
   const id=task.id,request=++logRequest.current
   setTab('log');setLog({taskId:id,loading:true})
   try{const result=await state.getTask(id,300000);if(request===logRequest.current)setLog({taskId:id,text:result.log||result.message})}
   catch(reason){if(request===logRequest.current)setLog({taskId:id,error:(reason as Error).message})}
 }
 const currentLog=log?.taskId===task.id?log:null
 return <section className="result-panel"><div className="section-heading"><h2>任务结果</h2><span className={`badge ${task.status}`}>{labels[task.status]}</span></div><p className="task-message">{task.message}</p>
 <div className="tabs"><button className={tab==='result'?'active':''} onClick={()=>setTab('result')}>结果</button><button className={tab==='input'?'active':''} onClick={()=>setTab('input')}>参数记录</button><button className={tab==='log'?'active':''} onClick={()=>void openLog()}>运行日志</button></div>
 {tab==='result'?children||<Artifacts state={state}/>:tab==='input'?<pre>{JSON.stringify({input:task.input,argv:task.argv},null,2)}</pre>:<pre>{currentLog?.error?'日志暂不可用：'+currentLog.error:currentLog?.loading?'正在读取日志…':currentLog?.text||'暂无日志'}</pre>}</section>
}
export function Artifacts({state}:{state:EngineState}){
 const task=state.task,[selected,setSelected]=useState(0)
 const [textPreview,setTextPreview]=useState<{key:string;text:string;error:string;loading:boolean}|null>(null)
 useEffect(()=>{setSelected(0)},[task?.id,task?.artifacts.length])
 const file=task?.artifacts[selected]
 const preview=file?.kind==='document'&&task?.artifacts[selected+1]?.kind==='html'?task.artifacts[selected+1]:file
 const tooLarge=typeof file?.size==='number'&&file.size>MAX_TEXT_PREVIEW_BYTES
 const waitingForDetails=state.deferredUrls&&!state.artifactDetailsReady
 const previewKey=task&&file?JSON.stringify([task.id,selected,file.path,file.kind,file.size]):''
 const currentText=textPreview?.key===previewKey?textPreview:null
 useEffect(()=>{
   if(!task||!file||!['text','json'].includes(file.kind)||tooLarge||waitingForDetails)return
   let active=true
   setTextPreview({key:previewKey,text:'',error:'',loading:true})
   void state.readArtifact(task.id,selected).then(value=>{
     if(active)setTextPreview({key:previewKey,text:value.text,error:'',loading:false})
   }).catch((reason:Error)=>{
     if(active)setTextPreview({key:previewKey,text:'',error:reason.message,loading:false})
   })
   return()=>{active=false}
 },[task?.id,selected,file?.path,file?.kind,file?.size,tooLarge,waitingForDetails,previewKey,state.readArtifact])
 if(!task||!file)return <p className="muted">任务结束后可查看生成的文件。</p>
 return <div><div className="artifact-toolbar"><select aria-label="结果文件" value={selected} onChange={e=>setSelected(Number(e.target.value))}>{task.artifacts.map((f,i)=><option key={i} value={i}>{f.name}</option>)}</select>{state.deferredUrls&&<button onClick={()=>void state.refresh(true)}><RefreshCw size={15}/>刷新链接</button>}<button onClick={async()=>{const result=await state.invoke('artifacts.export',{id:task.id,index:selected});if(result?.path)state.setNotice('已导出到 '+result.path)}}><Download size={15}/>导出结果</button></div>
 {['text','json'].includes(file.kind)
   ? tooLarge?<p className="muted">结果超过 2 MiB，请导出后查看完整内容。</p>
     :waitingForDetails?<p className="muted">{state.artifactDetailsError?'预览信息暂不可用：'+state.artifactDetailsError:'正在准备预览…'}</p>
     :currentText?.error?<p className="muted">预览不可用：{currentText.error}。仍可导出完整文件。</p>
     :currentText?.loading||!currentText?<p className="muted">正在读取预览…</p>
     :<pre className="artifact-text">{currentText.text}</pre>
   :state.deferredUrls&&state.artifactDetailsError?<p className="muted">预览链接暂不可用：{state.artifactDetailsError}</p>
   :!preview?.url&&['html','image','video','audio','pdf'].includes(preview?.kind||'')?<p className="muted">{preview?.urlError?'预览链接暂不可用：'+preview.urlError:'正在准备预览…'}</p>
   :preview?.kind==='html'?<><p className="muted">内容预览 · 与 Office 的分页排版可能不同</p><iframe title="文档内容预览" sandbox="" src={preview.url}/></>
   :file.kind==='image'?<img className="artifact-image" alt={file.name} src={file.url}/>
   :file.kind==='video'?<video className="media-preview" src={file.url} controls preload="metadata"/>
   :file.kind==='audio'?<audio className="media-preview" src={file.url} controls preload="metadata"/>
   :file.kind==='pdf'?<iframe title="PDF 预览" src={file.url}/>
   :<p className="muted">文件已生成，可导出使用。选择“内容预览”可在这里阅读。</p>}</div>
}
