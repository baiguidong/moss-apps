import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { hash, run } from '@moss/engine-apps/runtime'
import { alignParagraphs } from './paragraph-alignment.mjs'
import { officeZip, xml, serialize } from './office.mjs'
import { inspectPresentation, relationship, presentationObjects } from './pptx-edit.mjs'
const nodes=(node,name)=>Array.from(node.getElementsByTagName(name))
const digest=value=>createHash('sha256').update(value).digest('hex')
const column=n=>n<26?String.fromCharCode(65+n):column(Math.floor(n/26)-1)+String.fromCharCode(65+n%26)
export function citation(uri, location, label) {
  const params=new URLSearchParams(Object.entries(location).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))
  const href=uri+'#'+params.toString()
  return {label,uri:href,displayMarkdown:`[${String(label).replace(/[\[\]\\]/g,'')}](${href})`}
}
export async function inspectDocument(source, {signal,pdfText,directory}={}) {
  const ext=path.extname(source).toLowerCase(),sourceSha256=await hash(source),units=[],checks=[]
  if(ext==='.pdf') {
    let output,pages
    if(pdfText)pages=await pdfText(source,signal)
    else try {output=await run(process.platform==='darwin'?'/opt/homebrew/bin/pdftotext':'pdftotext',['-layout',source,'-'],{signal,maxBytes:8*1024**2})}
    catch(error){return {sourceSha256,units,checks:[{severity:'warning',message:'未能提取 PDF 文字：'+String(error.message).slice(0,200)}],complete:false}}
    if(!pages){pages=output.stdout.split('\f');if(!pages.at(-1)?.trim())pages.pop()}
    for(const [i,text]of pages.entries()) units.push({key:'page:'+i,label:`第 ${i+1} 页`,location:{page:i+1},text:text.trim(),signature:digest(text)})
    if(!units.some(u=>u.text))checks.push({severity:'warning',message:'PDF 没有可读文字层，原文引用只能定位页面；内容分析需要 OCR 或查看页图'})
  } else if(['.docx','.pptx','.xlsx'].includes(ext)) {
    const zip=await officeZip(source)
    if(ext==='.docx') {
      const doc=xml(await zip.file('word/document.xml').async('string'))
      nodes(doc,'w:p').forEach((p,i)=>{const text=nodes(p,'w:t').filter(t=>{let n=t.parentNode;while(n&&n!==p){if(n.nodeName==='w:del')return false;n=n.parentNode}return true}).map(t=>t.textContent).join('');units.push({key:'paragraph:'+(i+1),paragraph:i+1,label:`第 ${i+1} 段`,location:text?{text:text.slice(0,180)}:undefined,text,signature:digest(serialize(p))})})
      const preceding=[]
      for(const unit of units){
        if(unit.location?.text){const compact=v=>v.normalize('NFKC').replace(/\s+/gu,''),quote=compact(unit.location.text),all=compact(preceding.join(''));let count=0,offset=-1;while(quote&&(offset=all.indexOf(quote,offset+1))>=0)count++;if(count)unit.location.occurrence=count+1}
        preceding.push(unit.text)
      }
    } else if(ext==='.pptx') {
      const deck=await inspectPresentation(zip),pres=xml(await zip.file('ppt/presentation.xml').async('string')),size=nodes(pres,'p:sldSz')[0]
      const width=Number(size.getAttribute('cx'))/914400,height=Number(size.getAttribute('cy'))/914400
      for(const slide of deck){
        const doc=xml(await zip.file(slide.part).async('string'))
        for(const obj of slide.objects){
          const node=presentationObjects(doc)[obj.objectIndex];let signature=node?serialize(node):JSON.stringify(obj)
          if(obj.type==='chart'){
            const chart=nodes(node,'c:chart')[0],rel=await relationship(zip,slide.part,chart.getAttribute('r:id')),data=await zip.file(rel.part).async('string');signature+=data
            if(!nodes(xml(data),'c:ser').length)checks.push({severity:'error',message:`第 ${slide.slide} 页的图表没有数据系列`,location:{page:slide.slide,...(obj.text?{text:obj.text.slice(0,180)}:{})}})
          }
          if(obj.type==='image') {
            const blip=nodes(node,'a:blip')[0]
            if(blip?.getAttribute('r:embed')) {
              const rel=await relationship(zip,slide.part,blip.getAttribute('r:embed')),data=await zip.file(rel.part).async('nodebuffer'),sha256=digest(data)
              signature+=sha256;obj.imageSha256=sha256
              const extension=path.extname(rel.part).toLowerCase()
              if(directory&&['.png','.jpg','.jpeg','.webp','.gif'].includes(extension)&&data.length<=12*1024**2){
                const media=path.join(directory,'comparison-media');await fs.mkdir(media,{recursive:true})
                obj.imagePath=path.join(media,sha256+extension);await fs.writeFile(obj.imagePath,data)
              }
            }
          }
          const location={page:slide.slide,...(obj.text?{text:obj.text.slice(0,180)}:{})}
          const r=obj.bounds
          if(r&&(r.x<-.01||r.y<-.01||r.x+r.w>width+.01||r.y+r.h>height+.01))checks.push({severity:'error',message:`第 ${slide.slide} 页「${obj.name}」超出页面边界`,location:{page:slide.slide,...(obj.text?{text:obj.text.slice(0,180)}:{})}})
          const sizes=nodes(node,'a:rPr').map(n=>Number(n.getAttribute('sz'))/100).filter(n=>n>0)
          if(sizes.some(n=>n<12))checks.push({severity:'warning',message:`第 ${slide.slide} 页「${obj.name}」含小于 12 pt 的文字，请检查可读性`,location:{page:slide.slide,...(obj.text?{text:obj.text.slice(0,180)}:{})}})
          units.push({key:`slide:${slide.slide}:object:${obj.id}`,label:`第 ${slide.slide} 页 · ${obj.name||obj.type}`,location,slide:slide.slide,objectId:obj.id,text:obj.text||({bar:'柱形图',line:'折线图',pie:'饼图'}[obj.chartType]||{image:'图片',shape:'形状',group:'组合对象'}[obj.type]||'对象'),detail:obj,signature:digest(signature)})
        }
      }
    } else {
      const wb=xml(await zip.file('xl/workbook.xml').async('string')),strings=zip.file('xl/sharedStrings.xml')?nodes(xml(await zip.file('xl/sharedStrings.xml').async('string')),'si').map(si=>nodes(si,'t').map(t=>t.textContent).join('')):[]
      for(const sheet of nodes(wb,'sheet')){
        const name=sheet.getAttribute('name'),rel=await relationship(zip,'xl/workbook.xml',sheet.getAttribute('r:id')),doc=xml(await zip.file(rel.part).async('string'))
        for(const cell of nodes(doc,'c')){
          const address=cell.getAttribute('r');if(!address)continue
          const type=cell.getAttribute('t'),raw=nodes(cell,'v')[0]?.textContent||'',formula=nodes(cell,'f')[0]?.textContent
          const value=type==='s'?strings[Number(raw)]||'':type==='inlineStr'?nodes(cell,'t').map(t=>t.textContent).join(''):raw
          if(!value&&!formula)continue
          if(type==='e')checks.push({severity:'error',message:`${name}!${address}: ${value}`,location:{sheet:name,range:address}})
          units.push({key:`sheet:${name}:cell:${address}`,label:`${name}!${address}`,location:{sheet:name,range:address},text:formula?`=${formula}\n结果：${value}`:value,formula,value,signature:digest(serialize(cell)+(type==='s'?value:''))})
        }
      }
    }
  } else return {sourceSha256,units,checks:[{severity:'warning',message:'此格式尚未提供结构化内容检查'}],complete:false}
  if(await hash(source)!==sourceSha256)throw new Error('文件在检查期间变化，请重新读取')
  return {sourceSha256,units,checks,complete:true}
}
export function compareDocuments(before,after) {
  const old=new Map(before.units.map(u=>[u.key,u])),next=new Map(after.units.map(u=>[u.key,u])),changes=[]
  const paragraphs=[...before.units,...after.units].every(u=>Number.isInteger(u.paragraph))
  const pairs=paragraphs?alignParagraphs(before.units,after.units):[...new Set([...old.keys(),...next.keys()])].map(key=>[old.get(key),next.get(key)])
  for(const [a,b] of pairs){
    if(a?.signature===b?.signature)continue
    changes.push({key:`${a?.key||'added'}→${b?.key||'removed'}`,label:b?.label||a.label,kind:!a?'added':!b?'removed':'changed',before:a?{text:a.text,detail:a.detail,location:a.location}:null,after:b?{text:b.text,detail:b.detail,location:b.location}:null})
  }
  const visible=[];let bytes=0
  for(const change of changes.slice(0,1000)){
    const item={...change}
    for(const side of ['before','after'])if(item[side]){item[side]={...item[side],text:item[side].text.slice(0,8000),truncated:item[side].text.length>8000};if(JSON.stringify(item[side].detail||{}).length>12000){item[side].detail={type:item[side].detail.type};item[side].truncated=true}}
    bytes+=Buffer.byteLength(JSON.stringify(item));if(bytes>480*1024)break;visible.push(item)
  }
  return {complete:before.complete&&after.complete,count:changes.length,changes:visible,truncated:visible.length<changes.length}
}
