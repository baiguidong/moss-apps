import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
export { JSZip }
export const xml = text => {
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw new Error('不支持带外部实体的 Office XML')
  return new DOMParser({onError:level=>{if(level==='fatalError')throw new Error('Office XML 无效')}}).parseFromString(text,'application/xml')
}
export const serialize = doc => new XMLSerializer().serializeToString(doc)
export async function officeZip(file) {
  const zip=await JSZip.loadAsync(await fs.readFile(file));let size=0
  for(const entry of Object.values(zip.files)){size+=entry._data?.uncompressedSize||0;if(size>128*1024**2)throw new Error('Office 解压内容超过 128 MiB')}
  return zip
}
export async function officeText(file,kind) {
  const zip=await officeZip(file),names=kind==='presentation'?await (await import('./pptx-edit.mjs')).slideParts(zip):Object.keys(zip.files).filter(name=>/^word\/(document|header\d+|footer\d+)\.xml$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
  return Promise.all(names.map(async name=>{const doc=xml(await zip.file(name).async('string'));return {part:name,text:Array.from(doc.getElementsByTagName(kind==='presentation'?'a:p':'w:p')).map(p=>Array.from(p.getElementsByTagName(kind==='presentation'?'a:t':'w:t')).map(t=>t.textContent).join('')).join('\n')}}))
}
