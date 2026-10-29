import path from 'node:path'
import fs from 'node:fs/promises'
import { xml, serialize } from './office.mjs'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main', P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const nodes = (node, name) => Array.from(node.getElementsByTagName(name))
const children = node => Array.from(node.childNodes).filter(n => n.nodeType === 1)
const text = node => nodes(node, 'a:p').map(p => nodes(p,'a:t').map(t=>t.textContent).join('')).join('\n')
const relFile = part => path.posix.join(path.posix.dirname(part),'_rels',path.posix.basename(part)+'.rels')
export async function relationship(zip, part, id) {
  const file = zip.file(relFile(part)); if (!file) throw new Error('Office 对象缺少关系文件')
  const doc = xml(await file.async('string')), rel = nodes(doc,'Relationship').find(r=>r.getAttribute('Id')===id)
  if (!rel || rel.getAttribute('TargetMode') === 'External') throw new Error('不支持修改外部链接对象')
  const target = rel.getAttribute('Target'), targetPart = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join(path.posix.dirname(part),target))
  if (targetPart.startsWith('../') || !zip.file(targetPart)) throw new Error('Office 对象引用无效')
  return { doc, rel, part: targetPart, relPath: relFile(part) }
}
export async function slideParts(zip) {
  const doc=xml(await zip.file('ppt/presentation.xml').async('string'))
  return Promise.all(nodes(doc,'p:sldId').map(async node=>(await relationship(zip,'ppt/presentation.xml',node.getAttribute('r:id'))).part))
}
export function presentationObjects(doc) {
  const tree=nodes(doc,'p:spTree')[0]
  return tree ? children(tree).filter(n=>['p:sp','p:pic','p:graphicFrame','p:grpSp','p:cxnSp'].includes(n.nodeName)) : []
}
function kind(node) { return nodes(node,'c:chart').length?'chart':nodes(node,'a:tbl').length?'table':node.nodeName==='p:pic'?'image':node.nodeName==='p:grpSp'?'group':nodes(node,'a:t').length?'text':'shape' }
function transform(node) { return nodes(node,node.nodeName==='p:graphicFrame'?'p:xfrm':'a:xfrm')[0] }
function bounds(node) {
  const xf=transform(node), off=xf&&nodes(xf,'a:off')[0], ext=xf&&nodes(xf,'a:ext')[0]
  return off&&ext ? {x:Number(off.getAttribute('x'))/914400,y:Number(off.getAttribute('y'))/914400,w:Number(ext.getAttribute('cx'))/914400,h:Number(ext.getAttribute('cy'))/914400}:undefined
}
export async function inspectPresentation(zip) {
  const result=[]
  for(const [index,part] of (await slideParts(zip)).entries()) {
    const doc=xml(await zip.file(part).async('string')), entries=[]
    for(const [objectIndex,node] of presentationObjects(doc).entries()) {
      const identity=nodes(node,'p:cNvPr')[0], type=kind(node)
      const nativeId=identity?.getAttribute('id')
      const entry={id:`${nativeId}:${objectIndex+1}`,nativeId,objectIndex,name:identity?.getAttribute('name'),type,text:text(node),bounds:bounds(node),fontSizes:[...new Set(nodes(node,'a:rPr').map(n=>Number(n.getAttribute('sz'))/100).filter(n=>n>0))],fills:nodes(node,'a:solidFill').flatMap(n=>nodes(n,'a:srgbClr').map(c=>c.getAttribute('val')))}
      if(type==='table') entry.rows=nodes(node,'a:tr').map(row=>nodes(row,'a:tc').map(text))
      if(type==='chart') {
        const rel=await relationship(zip,part,nodes(node,'c:chart')[0].getAttribute('r:id')), chart=xml(await zip.file(rel.part).async('string'))
        entry.chartType=children(nodes(chart,'c:plotArea')[0]).find(n=>n.nodeName.endsWith('Chart'))?.localName.replace(/Chart$/,'')
      }
      entries.push(entry)
    }
    result.push({slide:index+1,part,objects:entries})
  }
  return result
}
function replaceText(node, value) {
  if(typeof value!=='string'||value.length>20000) throw new Error('对象文字无效')
  const texts=nodes(node,'a:t'); if(!texts.length) throw new Error('对象没有可编辑文字')
  // Preserve runs and paragraph formatting. New text occupies the first existing run.
  texts[0].textContent=value; for(const target of texts.slice(1)) target.textContent=''
}
function setFont(node, size) {
  if(!Number.isFinite(size)||size<6||size>200)throw new Error('字号需要 6–200 pt')
  const doc=node.ownerDocument
  for(const run of nodes(node,'a:r')) {let props=children(run).find(n=>n.nodeName==='a:rPr');if(!props){props=doc.createElementNS(A,'a:rPr');run.insertBefore(props,run.firstChild)}props.setAttribute('sz',String(Math.round(size*100)))}
  for(const props of [...nodes(node,'a:defRPr'),...nodes(node,'a:endParaRPr')])props.setAttribute('sz',String(Math.round(size*100)))
}
function changeChart(doc, type) {
  if(!['bar','line','pie'].includes(type))throw new Error('图表类型支持 bar、line、pie')
  const plot=nodes(doc,'c:plotArea')[0], charts=plot&&children(plot).filter(n=>n.nodeName.endsWith('Chart'))
  if(charts?.length!==1||!['c:barChart','c:lineChart','c:pieChart'].includes(charts[0].nodeName))throw new Error('当前只支持单一二维柱形、折线、饼图的类型修改')
  const old=charts[0], series=children(old).filter(n=>n.nodeName==='c:ser')
  if(type==='pie'&&(series.length!==1||nodes(series[0],'c:numCache').some(cache=>{const values=nodes(cache,'c:v').map(n=>Number(n.textContent));return values.some(n=>!Number.isFinite(n)||n<0)||!values.length||values.reduce((a,b)=>a+b,0)<=0})))throw new Error('饼图需要单一系列，数值非负且合计大于零')
  const make=(name,value)=>{const n=doc.createElementNS(C,'c:'+name);if(value!==undefined)n.setAttribute('val',value);return n}
  const next=make(type+'Chart')
  if(type==='bar'){next.appendChild(make('barDir','col'));next.appendChild(make('grouping','clustered'))}
  if(type==='line')next.appendChild(make('grouping','standard'))
  for(const original of series){const ser=original.cloneNode(true);for(const child of children(ser))if(['c:marker','c:smooth','c:invertIfNegative','c:dPt','c:explosion','c:trendline','c:errBars'].includes(child.nodeName))ser.removeChild(child);next.appendChild(ser)}
  const labels=children(old).find(n=>n.nodeName==='c:dLbls');if(labels)next.appendChild(labels.cloneNode(true))
  let axes=children(plot).filter(n=>['c:catAx','c:valAx'].includes(n.nodeName))
  if(type==='pie')for(const axis of axes)plot.removeChild(axis)
  else {
    if(!axes.length){
      for(const [name,id,cross,pos]of [['catAx','700001','700002','b'],['valAx','700002','700001','l']]){
        const axis=make(name);axis.appendChild(make('axId',id));const scaling=make('scaling');scaling.appendChild(make('orientation','minMax'));axis.appendChild(scaling);axis.appendChild(make('axPos',pos));axis.appendChild(make('crossAx',cross));axis.appendChild(make('crosses','autoZero'));plot.insertBefore(axis,old.nextSibling);axes.push(axis)
      }
    }
    for(const axis of axes)next.appendChild(make('axId',nodes(axis,'c:axId')[0].getAttribute('val')))
  }
  plot.replaceChild(next,old)
}
export async function editPresentation(zip, edits) {
  if(!Array.isArray(edits)||!edits.length||edits.length>200)throw new Error('请提供 1–200 个对象修改')
  const parts=await slideParts(zip), presentation=xml(await zip.file('ppt/presentation.xml').async('string')), size=nodes(presentation,'p:sldSz')[0]
  const width=Number(size?.getAttribute('cx'))/914400,height=Number(size?.getAttribute('cy'))/914400
  for(const edit of edits){
    if(!Number.isInteger(edit.slide)||!parts[edit.slide-1]||typeof edit.objectId!=='string')throw new Error('请使用读取结果中的 slide 和 objectId')
    const part=parts[edit.slide-1],doc=xml(await zip.file(part).async('string'))
    const all=presentationObjects(doc)
    const found=all.filter((node,index)=>`${nodes(node,'p:cNvPr')[0]?.getAttribute('id')}:${index+1}`===edit.objectId)
    if(found.length!==1)throw new Error('对象不存在或不唯一，请重新读取幻灯片')
    const node=found[0], type=kind(node)
    if(type==='group')throw new Error('组合对象暂不支持直接修改，请先在 PowerPoint 中取消组合')
    if(edit.expectedText!==undefined&&text(node)!==edit.expectedText)throw new Error('对象文字已变化，请重新读取后修改')
    if(!['text','fontSize','x','y','w','h','fill','chartType','tableEdits','imagePath'].some(key=>edit[key]!==undefined))throw new Error('对象修改没有提供变化内容')
    if(edit.text!==undefined){if(type==='table'||type==='chart')throw new Error('表格请使用 tableEdits，图表请使用 chartType');replaceText(node,edit.text)}
    if(edit.fontSize!==undefined){if(!nodes(node,'a:t').length)throw new Error('对象没有可修改字号的文字');setFont(node,edit.fontSize)}
    if(['x','y','w','h'].some(key=>edit[key]!==undefined)){
      const rect={...bounds(node),...Object.fromEntries(['x','y','w','h'].filter(k=>edit[k]!==undefined).map(k=>[k,edit[k]]))}
      if(!Object.values(rect).every(Number.isFinite)||rect.x<0||rect.y<0||rect.w<=0||rect.h<=0||rect.x+rect.w>width+.001||rect.y+rect.h>height+.001)throw new Error('修改后对象超出幻灯片边界')
      const xf=transform(node);if(!xf)throw new Error('对象继承母版位置，暂不支持直接调整尺寸')
      for(const [tag,values]of [['a:off',{x:rect.x,y:rect.y}],['a:ext',{cx:rect.w,cy:rect.h}]])for(const [key,value]of Object.entries(values))nodes(xf,tag)[0].setAttribute(key,String(Math.round(value*914400)))
    }
    if(edit.fill!==undefined){
      if(!/^[A-Fa-f0-9]{6}$/.test(edit.fill)||!['text','shape'].includes(type))throw new Error('填充仅支持普通形状的六位 RGB 色值')
      const props=nodes(node,'p:spPr')[0];for(const n of children(props))if(['a:noFill','a:solidFill','a:gradFill','a:blipFill','a:pattFill','a:grpFill'].includes(n.nodeName))props.removeChild(n)
      const fill=doc.createElementNS(A,'a:solidFill'),color=doc.createElementNS(A,'a:srgbClr');color.setAttribute('val',edit.fill);fill.appendChild(color);props.insertBefore(fill,children(props).find(n=>['a:ln','a:effectLst','a:effectDag','a:scene3d','a:sp3d','a:extLst'].includes(n.nodeName))||null)
    }
    if(edit.tableEdits!==undefined){
      if(type!=='table'||!Array.isArray(edit.tableEdits)||!edit.tableEdits.length||edit.tableEdits.length>1000)throw new Error('请提供表格单元格修改')
      for(const cell of edit.tableEdits){const row=nodes(node,'a:tr')[cell.row-1],target=row&&nodes(row,'a:tc')[cell.column-1];if(!Number.isInteger(cell.row)||!Number.isInteger(cell.column)||!target)throw new Error('表格行列位置无效（从 1 开始）');replaceText(target,cell.text)}
    }
    if(edit.chartType!==undefined){
      if(type!=='chart')throw new Error('目标对象不是图表')
      const rel=await relationship(zip,part,nodes(node,'c:chart')[0].getAttribute('r:id'))
      let references=0
      for(const candidate of parts){const other=xml(await zip.file(candidate).async('string'));for(const chart of nodes(other,'c:chart'))if((await relationship(zip,candidate,chart.getAttribute('r:id'))).part===rel.part)references++}
      if(references!==1)throw new Error('图表被多个对象共享，不能进行独立类型修改')
      const chart=xml(await zip.file(rel.part).async('string'));changeChart(chart,edit.chartType);zip.file(rel.part,serialize(chart))
    }
    if(edit.imagePath!==undefined){
      if(type!=='image'||!path.isAbsolute(edit.imagePath)||!/^\.(png|jpg|jpeg)$/i.test(path.extname(edit.imagePath)))throw new Error('图片替换需要 PNG/JPEG 的本地完整路径')
      if((await fs.stat(edit.imagePath)).size>12*1024**2)throw new Error('图片超过 12 MiB')
      const bytes=await fs.readFile(edit.imagePath);if(bytes.length>12*1024**2||!(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes[0]===255&&bytes[1]===216))throw new Error('图片格式无效或超过 12 MiB')
      const blip=nodes(node,'a:blip')[0],rel=await relationship(zip,part,blip.getAttribute('r:embed')),ext=bytes[0]===137?'png':'jpg'
      let n=1;while(zip.file(`ppt/media/moss-image-${n}.${ext}`))n++
      const target=`ppt/media/moss-image-${n}.${ext}`;zip.file(target,bytes)
      let rid='mossImage'+n;while(nodes(rel.doc,'Relationship').some(n=>n.getAttribute('Id')===rid))rid+='x'
      const newRel=rel.rel.cloneNode(true);newRel.setAttribute('Id',rid);newRel.setAttribute('Target','../media/'+path.posix.basename(target));rel.doc.documentElement.appendChild(newRel);blip.setAttributeNS(R,'r:embed',rid);zip.file(rel.relPath,serialize(rel.doc))
      const types=xml(await zip.file('[Content_Types].xml').async('string'));if(!nodes(types,'Default').some(n=>n.getAttribute('Extension')===ext)){const entry=types.createElementNS(types.documentElement.namespaceURI,'Default');entry.setAttribute('Extension',ext);entry.setAttribute('ContentType','image/'+(ext==='jpg'?'jpeg':'png'));types.documentElement.appendChild(entry);zip.file('[Content_Types].xml',serialize(types))}
    }
    zip.file(part,serialize(doc))
  }
}
