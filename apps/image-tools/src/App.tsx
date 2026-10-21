import { useEffect, useRef, useState } from 'react'
import { Image, Download, Crop, CheckCheck, RotateCcw } from 'lucide-react'
import { Shell, Empty, History, Submit, useWorkspace, bytes, type LocalFile } from '@moss/local-tasks/ui'
import { clampCrop, dragCrop, ratioCrop } from './crop-geometry.mjs'

const defaults = {format:'webp',quality:82,width:0,height:0,fit:'inside',position:'centre',allowEnlargement:false,background:'#ffffff',transparentBackground:false,border:0,rotation:0,flip:false,flop:false,brightness:1,saturation:1,hue:0,lightness:0,gamma:1,grayscale:false,negate:false,normalise:false,tint:'',blur:0,sharpen:0,median:0,thresholdEnabled:false,threshold:128,metadata:'strip'}
const groups=['格式与压缩','尺寸与填充','裁剪','旋转与翻转','色彩调整','清晰度','文字水印','图片信息']
const PREVIEW_RENEW_MS=12*60*60*1000
const positions=[['centre','居中'],['north','上方'],['northeast','右上'],['east','右侧'],['southeast','右下'],['south','下方'],['southwest','左下'],['west','左侧'],['northwest','左上']]
const handles=[['nw','左上'],['n','上边'],['ne','右上'],['e','右边'],['se','右下'],['s','下边'],['sw','左下'],['w','左边']]
type Rect={left:number;top:number;width:number;height:number}
type PreviewUrl={sourceUrl:string;url:string}
type PreviewFailure={sourceUrl:string;count:number;retryAt:number}
type PreviewRequest={id:string;sourceUrl:string;at:number}
export function App() {
  const state=useWorkspace(),inputs=state.workspace.files.filter(f=>f.role==='input')
  const [selected,setSelected]=useState<string[]>([]),[active,setActive]=useState(''),[resultId,setResultId]=useState(''),[group,setGroup]=useState(groups[0])
  const [settings,setSettings]=useState({...defaults}),[crop,setCrop]=useState(false),[drawing,setDrawing]=useState(false),[rect,setRect]=useState<Rect>({left:0,top:0,width:1,height:1}),[ratio,setRatio]=useState(0),[compare,setCompare]=useState(50)
  const [watermarkOn,setWatermarkOn]=useState(false),[watermark,setWatermark]=useState({text:'',fontSize:32,opacity:0.5,color:'#ffffff',position:'southeast',margin:16})
  const [previews,setPreviews]=useState<Record<string,PreviewUrl>>({}), [previewTick,setPreviewTick]=useState(0)
  const requestedPreviews=useRef(new Map<string,PreviewRequest>()), previewFailures=useRef(new Map<string,PreviewFailure>())
  const previewQueue=useRef<PreviewRequest[]>([]), activePreviews=useRef(0), previewAlive=useRef(true), drainPreviews=useRef<()=>void>(()=>{})
  const previewTimers=useRef(new Set<ReturnType<typeof setTimeout>>())
  const visibleResults=useRef(new Set<string>()), resultGridRef=useRef<HTMLElement>(null)
  const imageRef=useRef<HTMLImageElement>(null),gesture=useRef<{point:{x:number;y:number};rect:Rect;mode:string}|null>(null)
  const file=inputs.find(f=>f.id===active)||inputs[0],output=state.workspace.files.find(f=>f.id===resultId)
  const results=state.workspace.files.filter(f=>f.role==='output'&&f.kind==='image'),bounds={width:file?.metadata.width||1,height:file?.metadata.height||1}
  const web=window.location.protocol==='https:'
  const needsPreview=(item:LocalFile)=>web||item.metadata?.format==='tiff'&&!item.previewUrl
  const generatedPreviews=web||state.workspace.files.some(item=>item.kind==='image'&&needsPreview(item))
  const resultIds=results.filter(needsPreview).map(item=>item.id).join(',')
  const blank='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
  const imageUrl=(item:LocalFile)=>needsPreview(item)?(previews[item.id]?.sourceUrl===item.url?previews[item.id].url:blank):item.previewUrl||item.url
  useEffect(()=>{previewAlive.current=true;return()=>{previewAlive.current=false;previewQueue.current=[];requestedPreviews.current.clear();previewFailures.current.clear();for(const timer of previewTimers.current)clearTimeout(timer);previewTimers.current.clear()}},[])
  useEffect(()=>{
    if(!generatedPreviews)return
    const renew=()=>{if(!document.hidden)setPreviewTick(value=>value+1)}
    const timer=setInterval(renew,60*60*1000)
    window.addEventListener('focus',renew);document.addEventListener('visibilitychange',renew)
    return()=>{clearInterval(timer);window.removeEventListener('focus',renew);document.removeEventListener('visibilitychange',renew)}
  },[generatedPreviews])
  useEffect(()=>{
    if(!generatedPreviews)return
    visibleResults.current.clear()
    const grid=resultGridRef.current
    if(!grid)return
    const tiles=grid.querySelectorAll<HTMLElement>('[data-preview-id]')
    if(typeof IntersectionObserver==='undefined'){
      for(const tile of tiles)visibleResults.current.add(tile.dataset.previewId!)
      setPreviewTick(value=>value+1)
      return
    }
    const observer=new IntersectionObserver(entries=>{
      let changed=false
      for(const entry of entries){
        const id=(entry.target as HTMLElement).dataset.previewId
        if(!id)continue
        if(entry.isIntersecting&&!visibleResults.current.has(id)){visibleResults.current.add(id);changed=true}
        else if(!entry.isIntersecting&&visibleResults.current.delete(id))changed=true
      }
      if(changed)setPreviewTick(value=>value+1)
    },{rootMargin:'200px'})
    for(const tile of tiles)observer.observe(tile)
    return()=>observer.disconnect()
  },[generatedPreviews,resultIds])
  useEffect(()=>{
    if(!generatedPreviews){
      for(const request of previewQueue.current)if(requestedPreviews.current.get(request.id)===request)requestedPreviews.current.delete(request.id)
      previewQueue.current=[];drainPreviews.current=()=>{}
      return
    }
    if(document.hidden)return
    const images=new Map(state.workspace.files.filter(image=>image.kind==='image'&&needsPreview(image)).map(image=>[image.id,image]))
    const wantedIds=[...new Set([output?.id,file?.id,...visibleResults.current].filter((id):id is string=>Boolean(id)))]
    const wanted=new Set(wantedIds)
    for(const id of wanted){
      const image=images.get(id)
      if(!image)continue
      const previous=requestedPreviews.current.get(image.id)
      const failure=previewFailures.current.get(image.id)
      if(failure?.sourceUrl===image.url&&Date.now()<failure.retryAt)continue
      if(failure&&failure.sourceUrl!==image.url)previewFailures.current.delete(image.id)
      if(previous?.sourceUrl===image.url&&Date.now()-previous.at<PREVIEW_RENEW_MS)continue
      const request={id:image.id,sourceUrl:image.url,at:Date.now()}
      requestedPreviews.current.set(image.id,request)
      previewQueue.current.push(request)
    }
    previewQueue.current=previewQueue.current.filter(entry=>{
      if(requestedPreviews.current.get(entry.id)!==entry)return false
      if(!images.has(entry.id)){requestedPreviews.current.delete(entry.id);return false}
      if(wanted.has(entry.id))return true
      requestedPreviews.current.delete(entry.id)
      return false
    })
    const priority=new Map(wantedIds.map((id,index)=>[id,index]))
    previewQueue.current.sort((a,b)=>(priority.get(a.id)??Infinity)-(priority.get(b.id)??Infinity))
    const drain=()=>{
      while(previewAlive.current&&!document.hidden&&activePreviews.current<2&&previewQueue.current.length){
        const request=previewQueue.current.shift()!, {id,sourceUrl}=request
        if(requestedPreviews.current.get(id)!==request)continue
        activePreviews.current++
        void state.previewFile(id).then(result=>{
          if(previewAlive.current&&requestedPreviews.current.get(id)===request){previewFailures.current.delete(id);request.at=Date.now();setPreviews(previous=>({...previous,[id]:{sourceUrl,url:result.url}}))}
        }).catch(error=>{
          if(requestedPreviews.current.get(id)!==request)return
          requestedPreviews.current.delete(id)
          const previous=previewFailures.current.get(id)
          const failures=(previous?.sourceUrl===sourceUrl?previous.count:0)+1
          previewFailures.current.set(id,{sourceUrl,count:failures,retryAt:Date.now()+(failures<=2?failures*3000:60_000)})
          if(!previewAlive.current)return
          if(failures<=2){const timer=setTimeout(()=>{previewTimers.current.delete(timer);if(previewAlive.current)setPreviewTick(value=>value+1)},failures*3000);previewTimers.current.add(timer)}
          else state.setError(`图片预览失败：${error instanceof Error?error.message:String(error)}`)
        })
          .finally(()=>{activePreviews.current--;drainPreviews.current()})
      }
    }
    drainPreviews.current=drain
    drain()
  },[generatedPreviews,state.workspace.files,previewTick,state.previewFile,file?.id,output?.id])
  useEffect(()=>{if(!selected.length&&inputs.length){setSelected([inputs[0].id]);setActive(inputs[0].id)}},[inputs.length])
  useEffect(()=>{if(file)setRect({left:0,top:0,width:file.metadata.width,height:file.metadata.height});setCrop(false);gesture.current=null},[file?.id])
  const set=(key:keyof typeof defaults,value:any)=>setSettings(s=>({...s,[key]:value}))
  const toggle=(f:LocalFile)=>{setActive(f.id);setResultId('');setCrop(false);setSelected(ids=>ids.includes(f.id)?ids.filter(id=>id!==f.id):[...ids,f.id])}
  const cropAllowed=selected.length===1&&selected[0]===file?.id
  function point(event:React.PointerEvent){const box=imageRef.current?.getBoundingClientRect();return box?{x:Math.max(0,Math.min(bounds.width,(event.clientX-box.left)/box.width*bounds.width)),y:Math.max(0,Math.min(bounds.height,(event.clientY-box.top)/box.height*bounds.height))}:{x:0,y:0}}
  const number=(key:keyof typeof defaults,label:string,min:number,max:number,step=1)=><label className="field"><span>{label}</span><input aria-label={label} type="number" min={min} max={max} step={step} value={settings[key] as number} onChange={e=>set(key,Number(e.target.value))}/></label>
  const check=(key:keyof typeof defaults,label:string)=><label className="image-check"><input type="checkbox" checked={!!settings[key]} onChange={e=>set(key,e.target.checked)}/>{label}</label>
  const reset=()=>{setSettings({...defaults});setWatermarkOn(false);setCrop(false);setRatio(0);setResultId('')}
  const enabled=[crop?'裁剪':null,settings.width||settings.height?'调整尺寸':null,settings.rotation||settings.flip||settings.flop?'旋转/翻转':null,settings.brightness!==1||settings.saturation!==1||settings.hue||settings.lightness||settings.gamma!==1||settings.grayscale||settings.negate||settings.normalise||settings.tint?'调色':null,settings.blur||settings.sharpen||settings.median||settings.thresholdEnabled?'清晰度':null,watermarkOn?'水印':null,settings.border?'扩边':null].filter(Boolean)
  return <Shell title="图片工具" state={state}>
    <nav className="image-operations" aria-label="图片处理功能">
      <div className="image-operation-buttons">{groups.map(name=><button key={name} aria-pressed={group===name} onClick={()=>setGroup(name)}>{name}</button>)}</div>
      <label className="image-operation-select"><span>处理功能</span><select aria-label="处理功能" value={group} onChange={event=>setGroup(event.target.value)}>{groups.map(name=><option key={name}>{name}</option>)}</select></label>
    </nav>
    {!!inputs.length&&<div className="file-list"><button onClick={()=>{setSelected(selected.length===inputs.length?[]:inputs.map(f=>f.id));setCrop(false)}}><CheckCheck size={15}/>{selected.length===inputs.length?'取消全选':'全选'}</button>{inputs.map(f=><button className={`file-choice ${selected.includes(f.id)?'selected':''}`} key={f.id} onClick={()=>toggle(f)} aria-pressed={selected.includes(f.id)}><span>{f.name}</span><small>{bytes(f.size)}</small></button>)}</div>}
    <div className="workbench image-workbench"><section className="panel"><div className="section-title"><h2>{output?'处理结果':'原图预览'}</h2>{output&&<button onClick={()=>setResultId('')}>返回原图</button>}</div>
      {!file?<Empty title="选择图片开始处理" onImport={()=>void state.pick()}>转换、压缩、裁剪、缩放、旋转、调色、降噪和水印，可以组合后批量应用。</Empty>:<>
        <div className={`preview image-stage ${crop?'cropping':''}`}><div className="image-wrap" onPointerDown={event=>{
          if(!crop||!cropAllowed||event.button!==0)return
          event.preventDefault();const target=(event.target as HTMLElement).closest<HTMLElement>('[data-crop-handle]'),p=point(event)
          gesture.current={point:p,rect,mode:drawing?'draw':target?.dataset.cropHandle||'draw'};event.currentTarget.setPointerCapture(event.pointerId)
          if(drawing||!target)setRect(dragCrop(rect,p,p,'draw',bounds,ratio))
        }} onPointerMove={event=>{const g=gesture.current;if(g)setRect(dragCrop(g.rect,g.point,point(event),g.mode,bounds,ratio))}} onPointerUp={()=>{gesture.current=null;setDrawing(false)}} onPointerCancel={()=>{gesture.current=null}} onLostPointerCapture={()=>{gesture.current=null}}>
          <img ref={imageRef} src={output?imageUrl(output):imageUrl(file)} alt={output?.name||file.name} draggable={false}/>
          {output&&!output.metadata.transformed&&!output.metadata.cropped&&output.metadata.sourceId===file.id&&<img className="comparison-original" src={imageUrl(file)} alt="原图对比" style={{clipPath:`inset(0 ${100-compare}% 0 0)`}}/>}
          {crop&&cropAllowed&&<div className="crop-box" data-crop-handle="move" role="group" aria-label="裁剪选区" tabIndex={0} style={{left:`${rect.left/bounds.width*100}%`,top:`${rect.top/bounds.height*100}%`,width:`${rect.width/bounds.width*100}%`,height:`${rect.height/bounds.height*100}%`}} onKeyDown={event=>{if(!event.key.startsWith('Arrow'))return;event.preventDefault();const n=event.shiftKey?10:1;setRect(clampCrop({...rect,left:rect.left+(event.key==='ArrowLeft'?-n:event.key==='ArrowRight'?n:0),top:rect.top+(event.key==='ArrowUp'?-n:event.key==='ArrowDown'?n:0)},bounds))}}>
            <span className="crop-dimensions">{rect.width} × {rect.height}</span>{handles.map(([key,label])=><span key={key} role="button" aria-label={`调整裁剪${label}`} data-crop-handle={key} className={`crop-handle handle-${key}`}/>)}
          </div>}
        </div></div>
        <div className="detail-line"><span>{output?.name||file.name}</span><span>{(output||file).metadata.width} × {(output||file).metadata.height} · {bytes((output||file).size)}</span></div>
        {output&&<div className="comparison-controls">{!output.metadata.transformed&&!output.metadata.cropped?<label className="field"><span>左侧原图 / 右侧结果</span><input aria-label="图片前后对比" type="range" min="0" max="100" value={compare} onChange={e=>setCompare(+e.target.value)}/></label>:<small>画面结构已调整，可返回原图查看。</small>}<button onClick={()=>void state.exportFiles([output.id])}><Download size={15}/>导出结果</button></div>}
      </>}
    </section><aside className="panel image-options"><div className="section-title"><h2>{group}</h2><button aria-label="重置处理设置" onClick={reset}><RotateCcw size={14}/></button></div><div className="panel-body">
      {group===groups[0]&&<><label className="field"><span>输出格式</span><select aria-label="输出格式" value={settings.format} onChange={e=>set('format',e.target.value)}>{[['original','保持输入格式'],['webp','WebP'],['jpeg','JPEG'],['png','PNG'],['avif','AVIF'],['tiff','TIFF']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label><label className="field"><span>{settings.format==='png'?'PNG 无损压缩':`输出质量 · ${settings.quality}`}</span><input aria-label="输出质量" disabled={settings.format==='png'||settings.format==='tiff'} type="range" min="1" max="100" value={settings.quality} onChange={e=>set('quality',+e.target.value)}/></label><p className="muted">支持 JPEG、PNG、WebP、AVIF 和 TIFF 静态图片。透明背景和元数据策略可单独设置。</p></>}
      {group===groups[1]&&<><div className="fields">{number('width','目标宽度',0,8192)}{number('height','目标高度',0,8192)}</div><small>0 表示自动计算；宽高都为 0 时保留原尺寸。</small><label className="field"><span>适应方式</span><select aria-label="适应方式" value={settings.fit} onChange={e=>set('fit',e.target.value)}>{[['inside','等比缩放，完整放入'],['cover','等比填满，多余部分裁切'],['contain','等比放入，不足部分填充'],['fill','拉伸到指定宽高'],['outside','等比缩放，覆盖指定尺寸']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label><label className="field"><span>对齐位置</span><select value={settings.position} onChange={e=>set('position',e.target.value)}>{[...positions,...(settings.fit==='cover'?[['attention','自动关注主体'],['entropy','自动关注细节']]:[])].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>{check('allowEnlargement','允许放大小图')}{number('border','四周扩边',0,1024)}<label className="field"><span>填充 / JPEG 背景色</span><input aria-label="背景色" type="color" value={settings.background} onChange={e=>set('background',e.target.value)}/></label>{check('transparentBackground','扩边与留白使用透明背景')}<small>JPEG 不支持透明，使用上面选择的背景色。</small></>}
      {group===groups[2]&&<><button aria-pressed={crop} disabled={!cropAllowed} onClick={()=>{setCrop(!crop);setResultId('');setRect(ratioCrop(rect,bounds,ratio))}}><Crop size={16}/>{crop?'取消裁剪':'裁剪当前图片'}</button><p className="muted">选择一张图片。拖动空白区域创建选区，拖动选区移动，拖拽边角调整大小。</p><label className="field"><span>裁剪比例</span><select aria-label="裁剪比例" value={ratio} onChange={e=>{const r=+e.target.value;setRatio(r);setRect(ratioCrop(rect,bounds,r))}}>{[[0,'自由'],[1,'1:1'],[4/3,'4:3'],[3/4,'3:4'],[16/9,'16:9'],[9/16,'9:16']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>{crop&&<><div className="fields">{(['left','top','width','height'] as const).map((key,i)=><label className="field" key={key}><span>{['左边距','上边距','裁剪宽度','裁剪高度'][i]}</span><input aria-label={['左边距','上边距','裁剪宽度','裁剪高度'][i]} type="number" min={i>1?1:0} value={rect[key]} onChange={e=>setRect(ratioCrop({...rect,[key]:+e.target.value},bounds,ratio,key==='height'?'height':'width'))}/></label>)}</div><button aria-pressed={drawing} onClick={()=>setDrawing(!drawing)}>{drawing?'拖动图片绘制选区…':'重新框选'}</button><button onClick={()=>setRect(ratioCrop({left:0,top:0,...bounds},bounds,ratio))}>重置选区</button><small>点击“开始处理”应用裁剪。选区获得焦点后，方向键微调位置，Shift 加速。</small></>}</>}
      {group===groups[3]&&<><div className="rotation-presets">{[0,90,180,270].map(n=><button key={n} aria-pressed={settings.rotation===n} onClick={()=>set('rotation',n)}>{n}°</button>)}</div>{number('rotation','旋转角度',-360,360)}{check('flop','水平镜像')}{check('flip','垂直翻转')}<p className="muted">自动纠正 EXIF 方向后处理。手动裁剪基于当前原图，先裁剪再旋转。</p></>}
      {group===groups[4]&&<><div className="fields">{number('brightness','亮度倍率',0.1,3,0.05)}{number('saturation','饱和度倍率',0,3,0.05)}{number('hue','色相角度',0,360)}{number('lightness','明度偏移',-100,100)}{number('gamma','伽马',1,3,0.1)}</div>{check('grayscale','黑白')}{check('negate','反色')}{check('normalise','自动拉伸对比度')}<label className="image-check"><input type="checkbox" checked={!!settings.tint} onChange={e=>set('tint',e.target.checked?'#507eac':'')}/>单色着色</label>{settings.tint&&<input aria-label="着色色值" type="color" value={settings.tint} onChange={e=>set('tint',e.target.value)}/>}</>}
      {group===groups[5]&&<>{number('blur','模糊强度',0,20,0.3)}{number('sharpen','锐化强度',0,10,0.1)}<label className="field"><span>中值降噪</span><select aria-label="中值降噪" value={settings.median} onChange={e=>set('median',+e.target.value)}>{[0,3,5,7,9,11].map(n=><option key={n} value={n}>{n?`${n} × ${n}`:'关闭'}</option>)}</select></label>{check('thresholdEnabled','二值化')}{settings.thresholdEnabled&&number('threshold','二值化阈值',0,255)}<small>模糊与锐化设置为 0 时关闭，可与色彩调整组合。</small></>}
      {group===groups[6]&&<><label className="image-check"><input type="checkbox" checked={watermarkOn} onChange={e=>setWatermarkOn(e.target.checked)}/>添加文字水印</label><label className="field"><span>水印文字</span><input aria-label="水印文字" maxLength={120} value={watermark.text} onChange={e=>setWatermark({...watermark,text:e.target.value})}/></label><div className="fields">{(['fontSize','margin'] as const).map((key,i)=><label className="field" key={key}><span>{i?'水印边距':'水印字号'}</span><input aria-label={i?'水印边距':'水印字号'} type="number" min={i?0:8} max={i?1000:256} value={watermark[key]} onChange={e=>setWatermark({...watermark,[key]:+e.target.value})}/></label>)}</div><label className="field"><span>水印不透明度 · {Math.round(watermark.opacity*100)}%</span><input aria-label="水印不透明度" type="range" min="0.05" max="1" step="0.05" value={watermark.opacity} onChange={e=>setWatermark({...watermark,opacity:+e.target.value})}/></label><label className="field"><span>水印颜色</span><input aria-label="水印颜色" type="color" value={watermark.color} onChange={e=>setWatermark({...watermark,color:e.target.value})}/></label><label className="field"><span>水印位置</span><select aria-label="水印位置" value={watermark.position} onChange={e=>setWatermark({...watermark,position:e.target.value})}>{positions.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label></>}
      {group===groups[7]&&<><label className="field"><span>输出元数据</span><select aria-label="输出元数据" value={settings.metadata} onChange={e=>set('metadata',e.target.value)}><option value="strip">移除 EXIF、ICC 等原始元数据</option><option value="keep">保留上游支持的 EXIF、ICC 等元数据</option></select></label>{file&&<dl className="image-metadata">{[['格式',file.metadata.format],['像素',`${file.metadata.width} × ${file.metadata.height}`],['透明通道',file.metadata.hasAlpha?'有':'无'],['色彩空间',file.metadata.space||'未知'],['EXIF',file.metadata.hasExif?'有':'无'],['ICC 配置',file.metadata.hasIcc?'有':'无']].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}</>}
    </div><div className="image-submit"><small>已选 {selected.length} 张 · {settings.format==='original'?'原格式':settings.format.toUpperCase()}{enabled.length?` · ${enabled.join('、')}`:''}</small><Submit state={state} disabled={!selected.length||watermarkOn&&!watermark.text.trim()} onClick={()=>void state.invoke('tasks.start',{fileIds:selected,options:{...settings,...(crop&&cropAllowed?{crop:rect}:{}),...(watermarkOn?{watermark}:{})}})}>开始处理</Submit></div></aside></div>
    {!!results.length&&<section ref={resultGridRef} className="result-grid" aria-label="处理结果">{results.map(f=><button data-preview-id={needsPreview(f)?f.id:undefined} className={`result-tile ${resultId===f.id?'selected':''}`} key={f.id} onClick={()=>{setResultId(f.id);setActive(f.metadata.sourceId);setCrop(false)}}><img src={imageUrl(f)} alt={f.name}/><span>{f.name}</span><small>{bytes(f.size)}{f.metadata.inputSize>f.size?` · 减少 ${Math.round((1-f.size/f.metadata.inputSize)*100)}%`:''}</small></button>)}</section>}
    <History state={state} onSelect={task=>{const f=task.outputs.map(id=>state.workspace.files.find(file=>file.id===id&&file.kind==='image')).find(Boolean);if(f){setActive(f.metadata.sourceId);setResultId(f.id);setCrop(false)}}}/>
  </Shell>
}
