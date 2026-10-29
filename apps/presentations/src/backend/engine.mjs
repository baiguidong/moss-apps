import fs from 'node:fs/promises'
import path from 'node:path'
import pptxgen from 'pptxgenjs'
import { creationEngine, validateTitle, inputFile, safeName, escapeHtml as h, htmlDocument } from '@moss/creation-apps'
import { editPresentation, slideParts } from '@moss/creation-apps/pptx'
import { officeZip, officeText, xml, serialize } from '@moss/creation-apps/office'
const W=13.333333,H=7.5
const defaultFont=process.platform==='darwin'?'Heiti SC':process.platform==='win32'?'Microsoft YaHei':'Noto Sans CJK SC'
const color=value=>/^[0-9a-fA-F]{6}$/.test(value||'')?value:'172033'
export function validate(input){
 validateTitle(input)
 if(input.sourcePath){if(!['read','edit'].includes(input.mode))throw new Error('导入 PPTX 请选择 read 或 edit');return}
 if(input.mode && input.mode!=='create')throw new Error('读取或修改需要提供 PPTX 源文件')
 if(!Array.isArray(input.slides)||!input.slides.length||input.slides.length>80)throw new Error('需要 1–80 页幻灯片')
 for(const slide of input.slides){if((slide.elements?.length||0)>100)throw new Error('每页最多 100 个元素');for(const el of slide.elements||[]){if(!['text','table','chart','image','shape'].includes(el.type))throw new Error('不支持的幻灯片元素');for(const [key,max]of [['x',W],['y',H],['w',W],['h',H]])if(el[key]!==undefined&&(!Number.isFinite(el[key])||el[key]<0||el[key]>max))throw new Error('元素坐标或尺寸无效');if((el.x??.55)+(el.w??12)>W+.001||(el.y??1.5)+(el.h??4.8)>H+.001)throw new Error('元素超出页面边界')}}
}
function chartSvg(type,series){
 const labels=series[0]?.labels||[],low=Math.min(0,...series.flatMap(s=>s.values)),high=Math.max(1,...series.flatMap(s=>s.values)),yValue=v=>240-(v-low)/(high-low)*200,count=Math.max(1,labels.length),colors=['2563eb','16a34a','ea580c','9333ea'];let body=''
 if(type==='pie'){let a=-Math.PI/2;const sum=series[0].values.reduce((a,b)=>a+b,0);if(sum<=0||series[0].values.some(v=>v<0))throw new Error('饼图数值需非负且合计大于零');series[0].values.forEach((v,i)=>{const b=a+v/sum*Math.PI*2;body+=v===sum?`<circle cx="180" cy="140" r="110" fill="#${colors[i%4]}"/>`:`<path d="M180,140 L${180+110*Math.cos(a)},${140+110*Math.sin(a)} A110,110 0 ${b-a>Math.PI?1:0},1 ${180+110*Math.cos(b)},${140+110*Math.sin(b)} Z" fill="#${colors[i%4]}"/>`;body+=`<text x="330" y="${30+i*24}" fill="black" font-size="15">${h(labels[i])} ${v}</text>`;a=b})}
 else {body+=`<path d="M30,${yValue(0)}H570" stroke="#94a3b8"/>`;for(let s=0;s<series.length;s++){const points=[];series[s].values.forEach((v,i)=>{const x=40+(i+.5)*520/count,y=yValue(v);points.push(x+','+y);body+=`<text x="${x}" y="${y+(v<0?16:-8)}" text-anchor="middle" font-size="14">${v}</text>`;if(type==='bar')body+=`<rect x="${x-180/count+s*320/count/series.length}" y="${Math.min(yValue(0),y)}" width="${280/count/series.length}" height="${Math.abs(y-yValue(0))}" fill="#${colors[s%4]}"/>`;else body+=`<circle cx="${x}" cy="${y}" r="3" fill="#${colors[s%4]}"/>`});if(type==='line')body+=`<polyline points="${points.join(' ')}" stroke="#${colors[s%4]}" fill="none" stroke-width="3"/>`};labels.forEach((v,i)=>body+=`<text x="${40+(i+.5)*520/count}" y="270" text-anchor="middle" font-size="13">${h(v)}</text>`)}
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" style="width:100%;height:100%">${body}</svg>`
}
function preview(title,pages){
 return htmlDocument(title,`<header><strong>${h(title)}</strong><nav><button id="prev" aria-label="上一页">‹</button><span id="page"></span><button id="next" aria-label="下一页">›</button></nav></header>${pages.map((page,i)=>`<section class="slide" data-page="${i}" ${i?'hidden':''} style="background:#${page.background||'FFFFFF'}">${page.body}</section>`).join('')}<script>(()=>{let current=0;const api=window.mossVisualization,pages=[...document.querySelectorAll('[data-page]')],prev=document.getElementById('prev'),next=document.getElementById('next');function show(n){current=Math.max(0,Math.min(pages.length-1,Number(n)||0));pages.forEach((p,i)=>p.hidden=i!==current);document.getElementById('page').textContent=(current+1)+' / '+pages.length;prev.disabled=current===0;next.disabled=current===pages.length-1}show(api?.getState()?.page);prev.onclick=()=>{show(current-1);api?.setState({page:current})};next.onclick=()=>{show(current+1);api?.setState({page:current})};addEventListener('moss:state',e=>show(e.detail?.page));})();</script>`,`header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}nav{display:flex;gap:12px;align-items:center}.slide{container-type:inline-size;position:relative;aspect-ratio:16/9;color:#172033;border:1px solid #dce2e9;overflow:hidden}.element{position:absolute;white-space:pre-wrap;overflow:hidden;line-height:1.2}.slide table{width:100%;height:100%;table-layout:fixed}.slide td,.slide th{padding:.4cqw;color:inherit;border-color:#cbd5e1}.slide img{width:100%;height:100%;object-fit:contain}`)
}
const engine={id:'presentations',spec:{version:'0.1.0'},validate,
 async catalog(){return {modes:['create','read','edit'],units:'inches',page:{width:W,height:H},schema:JSON.parse(await fs.readFile(new URL('../../schemas/start.json',import.meta.url),'utf8'))}},
 async execute(input,ctx){
  validate(input);ctx.signal.throwIfAborted();const output=path.join(ctx.directory,safeName(input.title)+'.pptx'),html=path.join(ctx.directory,'preview.html');let pages=[],summary
  if(input.sourcePath){
   const file=await inputFile(input.sourcePath,['.pptx']),zip=await officeZip(file)
   if(input.mode==='edit'){
    if(!input.objectEdits?.length && (!Array.isArray(input.replacements)||!input.replacements.length))throw new Error('请提供文字替换或对象修改');if((input.replacements?.length||0)>200)throw new Error('文字替换最多 200 处')
    for(const replacement of input.replacements||[]){if(typeof replacement.find!=='string'||!replacement.find||typeof replacement.replace!=='string')throw new Error('文字替换无效');let count=0
     for(const [index,name] of (await slideParts(zip)).entries()){if(replacement.slide&&replacement.slide!==index+1)continue;const doc=xml(await zip.file(name).async('string'));for(const text of Array.from(doc.getElementsByTagName('a:t'))){if(text.textContent.includes(replacement.find)){text.textContent=text.textContent.split(replacement.find).join(replacement.replace);count++}}zip.file(name,serialize(doc))}
     if(!count)throw new Error('未找到待替换文字：'+replacement.find)
    }
    if(input.objectEdits?.length)await editPresentation(zip,input.objectEdits)
   }
   await fs.writeFile(output,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}))
   summary=await officeText(output,'presentation')
   pages=summary.map((p,i)=>({body:`<div class="element" style="inset:5%;font-size:2.2cqw"><strong>第 ${i+1} 页 · 内容预览</strong><p>${h(p.text)}</p></div>`}))
  }else{
   const ppt=new pptxgen();ppt.layout='LAYOUT_WIDE';ppt.author='Moss';ppt.subject=input.title;ppt.title=input.title;ppt.company='Moss';ppt.lang='zh-CN';ppt.theme={headFontFace:input.fontFace||defaultFont,bodyFontFace:input.fontFace||defaultFont,lang:'zh-CN'}
   for(const [index,spec]of input.slides.entries()){
    const slide=ppt.addSlide();slide.background={color:color(spec.background||'FFFFFF')};const elements=[...(spec.title?[{type:'text',text:spec.title,x:.55,y:.35,w:12.2,h:.75,fontSize:30,bold:true}]:[]),...(spec.body?[{type:'text',text:spec.body,x:.55,y:1.45,w:12.2,h:5.35,fontSize:22}]:[]),...(spec.elements||[])];let body=''
    for(const el of elements){
     const opts={x:el.x??.55,y:el.y??1.5,w:el.w??12,h:el.h??4.8},style=`left:${opts.x/W*100}%;top:${opts.y/H*100}%;width:${opts.w/W*100}%;height:${opts.h/H*100}%;font-size:${(el.fontSize||(el.type==='table'?17:22))/9.6}cqw;color:#${color(el.color)};${el.bold?'font-weight:700;':''}${el.align?'text-align:'+el.align+';':''}`
     let content=''
     if(el.type==='text'){if(typeof el.text!=='string'||el.text.length>20000)throw new Error('文字元素无效');slide.addText(el.text,{...opts,fontSize:el.fontSize||22,color:color(el.color),bold:!!el.bold,fontFace:input.fontFace||defaultFont,lang:'zh-CN',margin:0,breakLine:false,valign:'top',align:el.align||'left'});content=h(el.text)}
     else if(el.type==='table'){if(!Array.isArray(el.rows)||!el.rows.length||el.rows.length>40||el.rows.some(r=>!Array.isArray(r)||r.length>15))throw new Error('表格最多 40 行 15 列');slide.addTable(el.rows.map(r=>r.map(v=>String(v??''))),{...opts,fontSize:el.fontSize||17,fontFace:input.fontFace||defaultFont,lang:'zh-CN',border:{pt:1,color:'CBD5E1'},color:color(el.color),margin:4,autoPage:false});content='<table>'+el.rows.map((r,i)=>'<tr>'+r.map(v=>`<${i?'td':'th'}>${h(v)}</${i?'td':'th'}>`).join('')+'</tr>').join('')+'</table>'}
     else if(el.type==='chart'){if(!['bar','line','pie'].includes(el.chartType)||!Array.isArray(el.series)||!el.series.length||el.series.some(s=>!Array.isArray(s.labels)||!Array.isArray(s.values)||!s.labels.length||s.labels.length>100||s.labels.length!==s.values.length||s.values.some(v=>!Number.isFinite(v))))throw new Error('图表数据无效');if(el.chartType==='pie'&&el.series.length!==1)throw new Error('饼图仅支持一个系列');slide.addChart(ppt.ChartType[el.chartType],structuredClone(el.series),{...opts,chartColors:['2563EB','16A34A','EA580C','9333EA'],lang:'zh-CN',showLegend:true,showTitle:!!el.title,title:el.title||'',showValue:true});content=chartSvg(el.chartType,el.series)}
     else if(el.type==='image'){const file=await inputFile(el.path,['.png','.jpg','.jpeg'],12*1024**2),data='image/'+(path.extname(file)==='.png'?'png':'jpeg')+';base64,'+(await fs.readFile(file)).toString('base64');slide.addImage({data,...opts});content=`<img src="data:${data}" alt="${h(el.alt||'')}"/>`}
     else if(el.type==='shape'){if(!['rect','ellipse','line','chevron'].includes(el.shape||'rect'))throw new Error('不支持的形状');slide.addShape(ppt.ShapeType[el.shape||'rect'],{...opts,fill:{color:color(el.fill||'E2E8F0')},line:{color:color(el.color||'CBD5E1')}});content=el.shape==='line'?`<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%"><line x1="0" y1="0" x2="100" y2="100" stroke="#${color(el.color||'CBD5E1')}" vector-effect="non-scaling-stroke"/></svg>`:`<div style="width:100%;height:100%;background:#${color(el.fill||'E2E8F0')};${el.shape==='ellipse'?'border-radius:50%;':el.shape==='chevron'?'clip-path:polygon(0 0,70% 0,100% 50%,70% 100%,0 100%,30% 50%);':''}"></div>`}
     body+=`<div class="element" data-element="${index+1}-${body.length}" style="${style}">${content}</div>`
    }
    if(spec.notes)slide.addNotes(spec.notes)
    pages.push({body,background:color(spec.background||'FFFFFF')});await ctx.progress(`生成第 ${index+1} / ${input.slides.length} 页`)
   }
   await ppt.writeFile({fileName:output});summary=await officeText(output,'presentation')
  }
  await fs.writeFile(html,preview(input.title,pages));const text=path.join(ctx.directory,'slides.json');await fs.writeFile(text,JSON.stringify(summary,null,2))
  return {artifacts:[{name:path.basename(output),path:output,kind:'document'},{name:'幻灯片预览',path:html,kind:'html'},{name:'幻灯片文字.json',path:text,kind:'json'}],result:{pages:pages.length,previewIndex:1,previewMode:input.sourcePath?'text':'layout'},message:'演示文稿已生成'}
 }}
export default creationEngine(engine,{scheme:'moss-presentations',title:'演示文稿',tools:['presentation_create','presentation_status','presentation_read']})
