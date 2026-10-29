import fs from 'node:fs/promises'
import path from 'node:path'
import { inputFile, safeName, htmlDocument, escapeHtml as h } from '@moss/creation-apps'
import { officeZip, xml, serialize } from '@moss/creation-apps/office'
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export async function reviewDocument(input,ctx){
 const source=await inputFile(input.sourcePath,['.docx']),zip=await officeZip(source)
 const doc=xml(await zip.file('word/document.xml').async('string')),author=input.author||'Moss',date=new Date().toISOString()
 let nextId=Math.max(0,...Array.from(doc.getElementsByTagName('*')).map(e=>Number(e.getAttribute('w:id'))||0))+1
 const make=(name,value)=>{const node=doc.createElementNS(W,'w:'+name);if(value!==undefined)node.appendChild(doc.createTextNode(value));return node}
 let changes=0,comments=0
 for(const edit of input.edits||[]){
  if(typeof edit.find!=='string'||!edit.find||typeof edit.replace!=='string')throw new Error('修订需提供 find 和 replace')
  const paragraphs=Array.from(doc.getElementsByTagName('w:p'))
  if(edit.paragraph!==undefined&&(!Number.isInteger(edit.paragraph)||edit.paragraph<1||edit.paragraph>paragraphs.length))throw new Error('段落编号无效')
  const candidates=(edit.paragraph?[paragraphs[edit.paragraph-1]]:paragraphs).map(p=>({p,texts:Array.from(p.getElementsByTagName('w:t')).filter(t=>t.parentNode.nodeName==='w:r'&&t.parentNode.parentNode===p)})).map(entry=>({...entry,text:entry.texts.map(t=>t.textContent).join('')})).filter(entry=>entry.text.includes(edit.find))
  if(candidates.length!==1||candidates[0].text.split(edit.find).length!==2)throw new Error('修订文字需唯一；重复文字请使用内容索引中的 paragraph 指定段落：'+edit.find)
  const {p,texts,text:content}=candidates[0],start=content.indexOf(edit.find),end=start+edit.find.length
  let offset=0,inserted=false
  for(const text of texts){
   const run=text.parentNode,value=text.textContent,left=offset,right=offset+value.length;offset=right
   if(right<=start||left>=end)continue
   if(Array.from(run.childNodes).some(n=>n.nodeType===1&&!['w:rPr','w:t'].includes(n.nodeName))||run.getElementsByTagName('w:t').length!==1)throw new Error('选区包含复杂字段，请选择普通文字')
   // Reject a match bridged across hyperlinks, revisions or other non-run content.
   if(!inserted){const selected=texts.filter(t=>{const before=texts.slice(0,texts.indexOf(t)).reduce((n,x)=>n+x.textContent.length,0);return before<end&&before+t.textContent.length>start}).map(t=>t.parentNode);let n=selected[0];while(n&&n!==selected.at(-1)){if(n.nodeType===1&&n.nodeName!=='w:r')throw new Error('选区跨越复杂内容，不能安全修订');n=n.nextSibling}}
   const style=run.getElementsByTagName('w:rPr')[0]
   const newRun=(v,deleted=false)=>{const r=make('r');if(style)r.appendChild(style.cloneNode(true));const t=make(deleted?'delText':'t',v);t.setAttribute('xml:space','preserve');r.appendChild(t);return r}
   const a=Math.max(0,start-left),b=Math.min(value.length,end-left)
   if(a)p.insertBefore(newRun(value.slice(0,a)),run)
   const deleted=make('del');deleted.setAttribute('w:id',String(nextId++));deleted.setAttribute('w:author',author);deleted.setAttribute('w:date',date);deleted.appendChild(newRun(value.slice(a,b),true));p.insertBefore(deleted,run)
   if(!inserted&&edit.replace){const added=make('ins');added.setAttribute('w:id',String(nextId++));added.setAttribute('w:author',author);added.setAttribute('w:date',date);added.appendChild(newRun(edit.replace));p.insertBefore(added,run)}
   inserted=true
   if(b<value.length)p.insertBefore(newRun(value.slice(b)),run)
   p.removeChild(run)
  }
  changes++
 }
 let commentDoc=zip.file('word/comments.xml')?xml(await zip.file('word/comments.xml').async('string')):xml(`<w:comments xmlns:w="${W}"/>`)
 let commentId=Math.max(-1,...Array.from(commentDoc.getElementsByTagName('w:comment')).map(c=>Number(c.getAttribute('w:id'))))+1
 for(const comment of input.comments||[]){
  if(typeof comment.find!=='string'||!comment.find||typeof comment.text!=='string'||!comment.text.trim())throw new Error('批注需要定位文字及内容')
  const matches=Array.from(doc.getElementsByTagName('w:p')).filter(p=>Array.from(p.getElementsByTagName('w:t')).map(t=>t.textContent).join('').includes(comment.find))
  if(matches.length!==1)throw new Error('批注文字需定位到唯一段落：'+comment.find)
  const p=matches[0],id=String(commentId++),start=make('commentRangeStart'),end=make('commentRangeEnd'),ref=make('commentReference');for(const n of [start,end,ref])n.setAttribute('w:id',id)
  p.insertBefore(start,Array.from(p.childNodes).find(n=>n.nodeName!=='w:pPr')||null);p.appendChild(end);const r=make('r');r.appendChild(ref);p.appendChild(r)
  const entry=commentDoc.createElementNS(W,'w:comment');entry.setAttribute('w:id',id);entry.setAttribute('w:author',author);entry.setAttribute('w:date',date)
  const cp=commentDoc.createElementNS(W,'w:p'),cr=commentDoc.createElementNS(W,'w:r'),ct=commentDoc.createElementNS(W,'w:t');ct.appendChild(commentDoc.createTextNode(comment.text));cr.appendChild(ct);cp.appendChild(cr);entry.appendChild(cp);commentDoc.documentElement.appendChild(entry);comments++
 }
 if(!changes&&!comments)throw new Error('请提供修订或批注内容')
 zip.file('word/document.xml',serialize(doc))
 if(comments){
  zip.file('word/comments.xml',serialize(commentDoc))
  const relpath='word/_rels/document.xml.rels',rels=xml(await zip.file(relpath).async('string'))
  if(!Array.from(rels.getElementsByTagName('Relationship')).some(r=>r.getAttribute('Type').endsWith('/comments'))){const rel=rels.createElement('Relationship');rel.setAttribute('Id','mossComments'+Date.now());rel.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments');rel.setAttribute('Target','comments.xml');rels.documentElement.appendChild(rel);zip.file(relpath,serialize(rels))}
  const types=xml(await zip.file('[Content_Types].xml').async('string'));if(!Array.from(types.getElementsByTagName('Override')).some(t=>t.getAttribute('PartName')==='/word/comments.xml')){const t=types.createElement('Override');t.setAttribute('PartName','/word/comments.xml');t.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml');types.documentElement.appendChild(t);zip.file('[Content_Types].xml',serialize(types))}
 }
 const output=path.join(ctx.directory,safeName(input.title||'修订文档')+'.docx'),preview=path.join(ctx.directory,'review.html');await fs.writeFile(output,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}))
 const render=node=>{if(['w:t','w:delText'].includes(node.nodeName))return h(node.textContent);const body=Array.from(node.childNodes).map(render).join('');return node.nodeName==='w:ins'?'<ins>'+body+'</ins>':node.nodeName==='w:del'?'<del>'+body+'</del>':body}
 await fs.writeFile(preview,htmlDocument(input.title||'文档修订',Array.from(doc.getElementsByTagName('w:p')).map(p=>'<p>'+render(p)+'</p>').join('')+(input.comments||[]).map(c=>`<blockquote>${h(c.text)}</blockquote>`).join(''),'ins{color:#15803d}del{color:#b91c1c}'))
 return {artifacts:[{name:path.basename(output),path:output,kind:'document'},{name:'修订内容预览',path:preview,kind:'html'}],result:{changes,comments,previewIndex:1},message:'文档修订与批注已保存'}
}
