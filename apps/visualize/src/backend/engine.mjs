import fs from 'node:fs/promises'
import path from 'node:path'
import { composerActions } from './composer.mjs'
import { TaskStore, sessionResourceUri } from '@moss/engine-apps/runtime'

export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const colors = ['#2563eb','#16a34a','#ea580c','#9333ea','#0891b2','#db2777','#a16207','#475569']
export function parseCsv(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw new Error('CSV 最多支持 1 MiB')
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') { if (quoted && text[i+1] === '"') { cell += '"'; i++ } else if (quoted || !cell) quoted = !quoted; else throw new Error('CSV 引号位置无效') }
    else if (char === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((char === '\n' || char === '\r') && !quoted) { row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ''; if (char === '\r' && text[i+1] === '\n') i++ }
    else cell += char
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  row.push(cell); if (row.some(x => x.trim())) rows.push(row)
  if (rows.length < 2 || rows.length > 1001 || rows[0].length < 2 || rows[0].length > 9) throw new Error('需要表头和 1–1000 行数据，包含标签列及 1–8 个数值列')
  const headers = rows.shift().map(s => s.trim())
  if (headers.some(x => !x) || new Set(headers).size !== headers.length) throw new Error('表头不能为空或重复')
  return { headers, rows: rows.map((row, i) => {
    if (row.length !== headers.length || !row[0].trim()) throw new Error(`第 ${i+2} 行列数不符或标签为空`)
    return [row[0], ...row.slice(1).map(value => { if (!value.trim() || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1e15) throw new Error(`第 ${i+2} 行包含空值或非数值，请先整理数据`); return Number(value) })]
  }) }
}
export function validate(input) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw new Error('请输入 1–120 字的标题')
  if (input.parentId !== undefined && (typeof input.parentId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.parentId))) throw new Error('原作品 ID 无效')
  if (input.mode === 'html') {
    if (typeof input.html !== 'string' || !input.html.trim() || Buffer.byteLength(input.html) > 1024 * 1024) throw new Error('HTML 不能为空，最多支持 1 MiB')
    return
  }
  if (input.mode && input.mode !== 'chart') throw new Error('不支持的创作模式')
  if (!['bar','line','pie','scatter','table'].includes(input.type || 'bar')) throw new Error('不支持的图表类型')
  const { rows } = parseCsv(input.csv)
  if (input.type === 'scatter' && rows.some(row => !Number.isFinite(Number(row[0])) || Math.abs(Number(row[0])) > 1e15)) throw new Error('散点图第一列必须是数值 X 坐标')
  if (input.type === 'pie' && (rows.some(row => row[1] < 0) || rows.reduce((sum,row) => sum+row[1],0) <= 0)) throw new Error('饼图数值必须非负，且合计大于 0')
}
export function chartSvg(data, type, title) {
  const { headers, rows } = data, width = 960, height = 480, left = 75, top = 35, w = 850, h = 350
  const values = rows.flatMap(row => row.slice(1)), low = Math.min(0,...values), high = Math.max(0,...values), range = high-low || 1
  const xs = rows.map(row => Number(row[0])), xmin = Math.min(...xs), xmax = Math.max(...xs)
  const y = value => top+h-(value-low)/range*h, x = index => type === 'scatter' ? left + (xmax === xmin ? .5 : (xs[index]-xmin)/(xmax-xmin))*w : left+(index+.5)*w/rows.length
  let body = `<title>${escapeHtml(title)}</title><rect width="960" height="480" fill="white"/>`
  if (type === 'pie') {
    const total = rows.reduce((sum,row) => sum+row[1],0); let angle = -Math.PI/2
    rows.forEach((row,index) => { const next = angle+row[1]/total*Math.PI*2, cx=350, cy=220, r=160
      const shape = row[1] === total ? `<circle cx="${cx}" cy="${cy}" r="${r}"/>` : `<path d="M${cx},${cy} L${cx+r*Math.cos(angle)},${cy+r*Math.sin(angle)} A${r},${r} 0 ${next-angle>Math.PI?1:0},1 ${cx+r*Math.cos(next)},${cy+r*Math.sin(next)} Z"/>`
      body += `<g fill="${colors[index%colors.length]}">${shape}<title>${escapeHtml(row[0])}: ${row[1]}</title></g>`
      if (index < 15) body += `<text x="550" y="${55+index*25}" fill="${colors[index%colors.length]}" font-size="15">${escapeHtml(row[0])}: ${row[1]} (${(100*row[1]/total).toFixed(1)}%)</text>`
      angle=next
    })
  } else {
    for(let i=0;i<=5;i++) {const value=low+range*i/5;body+=`<path d="M${left},${y(value)}h${w}" stroke="#e2e8f0"/><text x="65" y="${y(value)+4}" text-anchor="end" font-size="12" fill="#475569">${Number(value.toPrecision(4))}</text>`}
    const step=Math.max(1,Math.ceil(rows.length/12))
    rows.forEach((row,index)=>{if(index%step===0)body+=`<text x="${x(index)}" y="410" text-anchor="middle" font-size="12" fill="#475569">${escapeHtml(row[0].slice(0,14))}</text>`})
    headers.slice(1).forEach((header,series)=>{
      const color=colors[series], points=rows.map((row,index)=>[x(index),y(row[series+1])])
      body+=`<g data-series="${series}" fill="${color}" stroke="${color}">`
      if(type==='line')body+=`<polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke-width="2"/>`
      rows.forEach((row,index)=>{const [cx,cy]=points[index],label=`${escapeHtml(row[0])} · ${escapeHtml(header)}: ${row[series+1]}`
        if(type==='bar'||type==='table'){const bw=Math.max(.2,w/rows.length*.8/(headers.length-1));body+=`<rect x="${cx-w/rows.length*.4+series*bw}" y="${Math.min(cy,y(0))}" width="${bw*.9}" height="${Math.max(.3,Math.abs(cy-y(0)))}"><title>${label}</title></rect>`}
        else body+=`<circle cx="${cx}" cy="${cy}" r="${rows.length>150?2:4}"><title>${label}</title></circle>`
      });body+='</g>'
      body+=`<text x="${left+series*105}" y="452" fill="${color}" font-size="13">${escapeHtml(header.slice(0,12))}</text>`
    })
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}" style="width:100%;height:auto;font-family:system-ui,sans-serif">${body}</svg>`
}
export function htmlDocument(title, body) {
  const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escapeHtml(title)}</title><style>html{color-scheme:light dark}body{font:15px/1.6 system-ui,sans-serif;margin:20px;color:light-dark(#172033,#e4ece5);background:light-dark(white,#202621)}h1{font-size:23px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}input{padding:8px;border:1px solid #cbd5e1;border-radius:6px}label{display:inline-flex;gap:5px;margin-right:15px}.table{overflow:auto}button{padding:7px 12px;margin:8px;border:1px solid #cbd5e1;background:white;border-radius:6px}@media(max-width:500px){body{margin:10px}h1{font-size:19px}}</style></head><body>${body}</body></html>`
}
export default {
  async register(backend, context) { const actions = composerActions(context.dataDir); backend.registerAction('composer.list', actions.list); backend.registerAction('composer.resolve', actions.resolve) },
  id:'visualize',spec:{version:'0.1.0'}, catalog:async()=>({version:'0.1.0',types:['bar','line','pie','scatter','table'],
    templates:[{id:'compound-growth',title:'可调节的复利演示',html:await fs.readFile(new URL('../../resources/skills/moss-visualize/examples/compound-growth.html',import.meta.url),'utf8')}],
    instructions:await fs.readFile(new URL('../../resources/skills/moss-visualize/references/runtime.md',import.meta.url),'utf8'),
  }), validate,
  async execute(input,ctx) {
    validate(input);ctx.signal.throwIfAborted();await ctx.progress('正在生成可视化')
    const taskId=path.basename(ctx.directory)
    let version=1,workId=taskId
    if(input.parentId){
      const parent=await new TaskStore(ctx.dataDir).get(input.parentId)
      if(parent.status!=='succeeded'||!parent.result?.resourceUri)throw new Error('原作品尚未生成，无法创建新版本')
      version=(parent.result.version||1)+1;workId=parent.result.workId||parent.id
    }
    let html, artifacts=[]
    if(input.mode==='html') html=htmlDocument(input.title,input.html)
    else {
      const data=parseCsv(input.csv), type=input.type||'bar', svg=chartSvg(data,type,input.title)
      const table=`<div class="table"><table><thead><tr>${data.headers.map(x=>`<th>${escapeHtml(x)}</th>`).join('')}</tr></thead><tbody>${data.rows.map(row=>`<tr>${row.map(x=>`<td>${escapeHtml(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      const controls=type==='pie'?'':data.headers.slice(1).map((name,i)=>`<label><input type="checkbox" data-toggle="${i}" checked>${escapeHtml(name)}</label>`).join('')
      const script = `(()=>{const api=window.mossVisualization,filter=document.getElementById('filter'),toggles=[...document.querySelectorAll('[data-toggle]')];
        let state={filter:'',hiddenSeries:[]};
        function restore(value){if(!value||typeof value!=='object')return;state={filter:typeof value.filter==='string'?value.filter.slice(0,200):'',hiddenSeries:Array.isArray(value.hiddenSeries)?value.hiddenSeries.filter(x=>Number.isInteger(x)&&x>=0&&x<8):[]};}
        function render(){filter.value=state.filter;for(const row of document.querySelectorAll('tbody tr'))row.hidden=!row.textContent.toLowerCase().includes(state.filter.toLowerCase());for(const input of toggles){const i=Number(input.dataset.toggle),hidden=state.hiddenSeries.includes(i);input.checked=!hidden;for(const group of document.querySelectorAll('[data-series="'+i+'"]'))group.style.display=hidden?'none':'';for(const cell of document.querySelectorAll('tr>*:nth-child('+(i+2)+')'))cell.hidden=hidden;}}
        restore(api?.getState());render();filter.addEventListener('input',()=>{state.filter=filter.value;render();api?.setState(state);});for(const input of toggles)input.addEventListener('change',()=>{state.hiddenSeries=toggles.filter(x=>!x.checked).map(x=>Number(x.dataset.toggle));render();api?.setState(state);});addEventListener('moss:state',event=>{restore(event.detail);render();});})();`
      html=htmlDocument(input.title,`<h1>${escapeHtml(input.title)}</h1><div>${controls}</div><div id="chart" ${type==='table'?'hidden':''}>${svg}</div><label>筛选下方表格 <input id="filter" maxlength="200" placeholder="输入标签或数值"></label>${table}<script>${script}</script>`)
      for(const [name,contents,kind]of [['chart.svg',svg,'image'],['data.csv',input.csv,'text'],['data.json',JSON.stringify(data,null,2),'json']]) {const file=path.join(ctx.directory,name);await fs.writeFile(file,contents);artifacts.push({name,path:file,kind})}
    }
    if(Buffer.byteLength(html)>2*1024*1024)throw new Error('生成的作品超过 2 MiB，请减少数据或拆分图表')
    const file=path.join(ctx.directory,'visualization.html');await fs.writeFile(file,html)
    artifacts.unshift({name:input.title.replace(/[\x00-\x1f<>:"/\\|?*]/g,'_')+'.html',path:file,kind:'html'})
    const source=path.join(ctx.directory,'source.json');await fs.writeFile(source,JSON.stringify(input,null,2));artifacts.push({name:'创作源文件.json',path:source,kind:'json'})
    const resourceUri=sessionResourceUri('moss-visualize://works/'+taskId,ctx.sessionId)
    return {artifacts,message:'可视化已生成，可在主会话及右侧成果区交互',result:{mode:input.mode||'chart',resourceUri,workId,version,parentId:input.parentId||null,
      presentation:{items:[{resource_uri:resourceUri,title:input.title,role:'primary'}],mode:'auto'},
      displayMarkdown:'```moss-visualization\n'+JSON.stringify({resource_uri:resourceUri,title:input.title})+'\n```'}}
  },
}
