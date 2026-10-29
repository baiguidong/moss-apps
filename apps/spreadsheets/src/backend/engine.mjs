import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import SSF from 'ssf'
import { HyperFormula } from 'hyperformula'
import { creationEngine, validateTitle, inputFile, safeName, escapeHtml as h, htmlDocument } from '@moss/creation-apps'
import { JSZip, officeZip, xml, serialize } from '@moss/creation-apps/office'
const columnName=number=>{let result='';for(let n=number;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result}
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const primitive=v=>v===null||['string','number','boolean'].includes(typeof v)
// ExcelJS cell.value omits falsy cached formula results. The result accessor
// preserves 0, false and empty strings, including shared formulas.
const cellValue=cell=>cell.formula?{...cell.value,result:cell.result}:cell.value
const valueOf=cell=>cell.formula?'='+cell.formula.replace(/^=/,''):cell.value?.richText?cell.value.richText.map(p=>p.text).join(''):cell.value?.text??cell.value
export function validate(input) {
  validateTitle(input)
  if(input.mode && !['create','read','edit'].includes(input.mode))throw new Error('不支持的表格操作')
  if(input.sourcePath){if(!['read','edit'].includes(input.mode))throw new Error('导入文件请选择 read 或 edit');return}
  if(!Array.isArray(input.sheets)||!input.sheets.length||input.sheets.length>30)throw new Error('需要 1–30 个工作表')
  const names=new Set();let total=0
  for(const sheet of input.sheets){
    if(typeof sheet.name!=='string'||!sheet.name||sheet.name.length>31||/[\\/*?:\[\]]/.test(sheet.name)||names.has(sheet.name.toLowerCase()))throw new Error('工作表名称无效或重复')
    names.add(sheet.name.toLowerCase())
    if(!Array.isArray(sheet.rows)||sheet.rows.length>10000)throw new Error('单表最多 10000 行')
    for(const row of sheet.rows){if(!Array.isArray(row)||row.length>200)throw new Error('单行最多 200 列');total+=row.length;for(const cell of row)if(!primitive(cell)&&(!cell||typeof cell!=='object'||Array.isArray(cell)||(!('formula'in cell)&&!('value'in cell))))throw new Error('单元格需要值或公式')}
    if((sheet.charts?.length||0)>20)throw new Error('单表最多 20 个图表')
  }
  if(total>100000)throw new Error('工作簿最多 100000 个单元格')
}
function recalculate(book) {
  const data=Object.fromEntries(book.worksheets.map(sheet=>[sheet.name,Array.from({length:sheet.rowCount},(_,row)=>Array.from({length:sheet.columnCount},(_,col)=>{const v=valueOf(sheet.getCell(row+1,col+1));return v instanceof Date?v.toISOString():v??null}))]))
  const engine=HyperFormula.buildFromSheets(data,{licenseKey:'gpl-v3'}),errors=[]
  try {for(const sheet of book.worksheets){const id=engine.getSheetId(sheet.name);sheet.eachRow(row=>row.eachCell(cell=>{if(cell.formula){const value=engine.getCellValue({sheet:id,row:cell.row-1,col:cell.col-1});if(value && typeof value==='object' && 'type'in value)errors.push(`${sheet.name}!${cell.address}: ${value.value||value.type}`);else cell.value={formula:cell.formula,result:value??''}}}))}} finally {engine.destroy()}
  if(errors.length)throw new Error('公式计算失败：'+errors.slice(0,15).join('；'))
}
function display(cell) {
  const value=cell.formula?(cell.result??'='+cell.formula):cell.value
  if(value instanceof Date)return value.toISOString()
  return value?.richText?.map(r=>r.text).join('')??value?.text??value?.error??(primitive(value)?value:'')??''
}
function formatted(cell,book) {
  const raw=cell.formula?cell.result:cell.value
  const value=raw instanceof Date?raw:display(cell)
  if(typeof value==='number'||value instanceof Date){
    try{return SSF.format(cell.numFmt||(value instanceof Date?'yyyy-mm-dd':'General'),value,{date1904:book.properties.date1904})}
    catch {return display(cell)}
  }
  return value
}
function renderCharts(sheet, charts = []) {
  return charts.map(chart => {
    const labels = rangeValues(sheet, chart.labels), series = chart.series.map(s => ({name:s.name, values:rangeValues(sheet,s.range)})), colors=['#2563eb','#16a34a','#ea580c','#9333ea']
    const all=series.flatMap(s=>s.values),low=Math.min(0,...all),high=Math.max(1,...all),scale=high-low,y=v=>240-(v-low)/scale*200,x=i=>50+(i+.5)*500/labels.length;let shapes=''
    if(chart.type==='pie'){let a=-Math.PI/2;const sum=series[0].values.reduce((a,b)=>a+b,0);series[0].values.forEach((v,i)=>{const b=a+v/sum*2*Math.PI;shapes+=v===sum?`<circle cx="180" cy="140" r="100" fill="${colors[i%4]}"/>`:`<path d="M180,140 L${180+100*Math.cos(a)},${140+100*Math.sin(a)} A100,100 0 ${b-a>Math.PI?1:0},1 ${180+100*Math.cos(b)},${140+100*Math.sin(b)} Z" fill="${colors[i%4]}"/>`;shapes+=`<text x="320" y="${40+i*22}" fill="currentColor">${h(labels[i])}: ${v}</text>`;a=b})}
    else {shapes+=`<path d="M40,${y(0)}H570" stroke="#94a3b8"/>`;series.forEach((s,j)=>{if(chart.type==='line')shapes+=`<polyline points="${s.values.map((v,i)=>x(i)+','+y(v)).join(' ')}" fill="none" stroke="${colors[j%4]}" stroke-width="3"/>`;else s.values.forEach((v,i)=>{const w=400/labels.length/series.length;shapes+=`<rect x="${x(i)-200/labels.length+j*w}" y="${Math.min(y(0),y(v))}" width="${w*.85}" height="${Math.abs(y(v)-y(0))}" fill="${colors[j%4]}"/>`})});labels.forEach((v,i)=>shapes+=`<text x="${x(i)}" y="270" font-size="12" text-anchor="middle" fill="currentColor">${h(v)}</text>`)}
    return `<figure><figcaption>${h(chart.title||sheet.name)}</figcaption><svg role="img" aria-label="${h(chart.title||sheet.name)}" viewBox="0 0 600 300" style="width:100%;max-width:800px">${shapes}</svg></figure>`
  }).join('')
}
function render(book, specs = []) {
  return htmlDocument(book.title||'表格',`<h1>${h(book.title||'表格')}</h1><label>工作表 <select id="sheet">${book.worksheets.map((s,i)=>`<option value="${i}">${h(s.name)}</option>`).join('')}</select></label>${book.worksheets.map((sheet,i)=>`<section data-sheet="${i}" ${i?'hidden':''}><h2>${h(sheet.name)}</h2>${renderCharts(sheet,specs[i]?.charts)}<div style="overflow:auto"><table><tbody>${Array.from({length:Math.min(sheet.rowCount,300)},(_,r)=>`<tr>${Array.from({length:Math.min(sheet.columnCount,40)},(_,c)=>`<${r===0?'th':'td'} title="${h(sheet.getCell(r+1,c+1).value?.formula||'')}">${h(formatted(sheet.getCell(r+1,c+1),book))}</${r===0?'th':'td'}>`).join('')}</tr>`).join('')}</tbody></table></div>${sheet.rowCount>300||sheet.columnCount>40?'<p>预览显示前 300 行、40 列，完整数据保存在工作簿中。</p>':''}</section>`).join('')}<script>(()=>{const select=document.getElementById('sheet'),api=window.mossVisualization;function show(value){select.value=String(Math.max(0,Math.min(select.options.length-1,Number(value)||0)));document.querySelectorAll('[data-sheet]').forEach(el=>el.hidden=el.dataset.sheet!==select.value)}show(api?.getState()?.sheet);select.onchange=()=>{show(select.value);api?.setState({sheet:Number(select.value)})};addEventListener('moss:state',e=>show(e.detail?.sheet));})();</script>`)
}
function rangeValues(sheet,range) {
  const match=/^([A-Z]{1,3})([1-9]\d*):([A-Z]{1,3})([1-9]\d*)$/.exec(range||'')
  if(!match||match[1]!==match[3]||Number(match[4])<Number(match[2])||Number(match[4])-Number(match[2])>1000)throw new Error('图表范围需要同一列的 1–1001 个单元格')
  return Array.from({length:Number(match[4])-Number(match[2])+1},(_,i)=>display(sheet.getCell(match[1]+(Number(match[2])+i))))
}
async function addCharts(buffer,book,specs) {
  const zip=await JSZip.loadAsync(buffer),types=xml(await zip.file('[Content_Types].xml').async('string'));let number=0
  for(let s=0;s<specs.length;s++){
    const sheet=book.worksheets[s],charts=specs[s].charts||[];if(!charts.length)continue
    let anchors='',rels=''
    for(let c=0;c<charts.length;c++){
      const chart=charts[c],id=++number,type=chart.type||'bar'
      if(!['bar','line','pie'].includes(type)||!Array.isArray(chart.series)||!chart.series.length||chart.series.length>8)throw new Error('图表支持 bar、line、pie 及 1–8 个系列')
      if(type==='pie' && chart.series.length!==1)throw new Error('饼图仅支持一个系列')
      const labels=rangeValues(sheet,chart.labels),ref=r=>h(`'${sheet.name.replace(/'/g,"''")}'!${r}`)
      const series=chart.series.map((entry,i)=>{const values=rangeValues(sheet,entry.range);if(values.length!==labels.length||values.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new Error('图表数值范围必须与标签等长且都是数值');if(type==='pie'&&(values.some(v=>v<0)||values.reduce((a,b)=>a+b,0)<=0))throw new Error('饼图数值需非负且合计大于零');return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${h(entry.name||'系列 '+(i+1))}</c:v></c:tx><c:cat><c:strRef><c:f>${ref(chart.labels)}</c:f><c:strCache><c:ptCount val="${labels.length}"/>${labels.map((v,i)=>`<c:pt idx="${i}"><c:v>${h(v)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${ref(entry.range)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v,i)=>`<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val></c:ser>`}).join('')
      const axes=type==='pie'?'':`<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx>`
      zip.file(`xl/charts/chart${id}.xml`,`<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${h(chart.title||sheet.name)}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:${type}Chart>${type==='bar'?'<c:barDir val="col"/><c:grouping val="clustered"/>':type==='line'?'<c:grouping val="standard"/>':''}${series}${type==='pie'?'':'<c:axId val="1"/><c:axId val="2"/>'}</c:${type}Chart>${axes}</c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`)
      const addType=(part,content)=>{const e=types.createElement('Override');e.setAttribute('PartName',part);e.setAttribute('ContentType',content);types.documentElement.appendChild(e)}
      addType(`/xl/charts/chart${id}.xml`,'application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
      anchors+=`<xdr:twoCellAnchor><xdr:from><xdr:col>${sheet.columnCount+1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c*18}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${sheet.columnCount+10}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${c*18+16}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id+1}" name="Chart ${id}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${c+1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`
      rels+=`<Relationship Id="rId${c+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${id}.xml"/>`
    }
    const n=s+1,doc=xml(await zip.file(`xl/worksheets/sheet${n}.xml`).async('string')),drawing=doc.createElementNS(NS,'drawing');drawing.setAttribute('r:id','mossCharts');doc.documentElement.appendChild(drawing)
    zip.file(`xl/worksheets/sheet${n}.xml`,serialize(doc))
    const relfile=`xl/worksheets/_rels/sheet${n}.xml.rels`,rdoc=xml(zip.file(relfile)?await zip.file(relfile).async('string'):'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),rel=rdoc.createElement('Relationship');rel.setAttribute('Id','mossCharts');rel.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing');rel.setAttribute('Target',`../drawings/moss${n}.xml`);rdoc.documentElement.appendChild(rel);zip.file(relfile,serialize(rdoc))
    zip.file(`xl/drawings/moss${n}.xml`,`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`)
    zip.file(`xl/drawings/_rels/moss${n}.xml.rels`,`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`)
    const t=types.createElement('Override');t.setAttribute('PartName',`/xl/drawings/moss${n}.xml`);t.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.drawing+xml');types.documentElement.appendChild(t)
  }
  zip.file('[Content_Types].xml',serialize(types));return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
}
async function patchImported(file,book,edits) {
  const zip=await officeZip(file)
  // Resolve actual worksheet paths rather than assuming sheet IDs match ZIP names.
  const wb=xml(await zip.file('xl/workbook.xml').async('string')),rels=xml(await zip.file('xl/_rels/workbook.xml.rels').async('string'))
  for(const sheet of book.worksheets){
    const entry=Array.from(wb.getElementsByTagName('sheet')).find(e=>e.getAttribute('name')===sheet.name),rel=Array.from(rels.getElementsByTagName('Relationship')).find(e=>e.getAttribute('Id')===entry.getAttribute('r:id'))
    const target=rel.getAttribute('Target'),part=target.startsWith('/')?target.slice(1):path.posix.normalize('xl/'+target),doc=xml(await zip.file(part).async('string'))
    const changed=new Set(edits.filter(e=>e.sheet===sheet.name).map(e=>e.cell))
    const cells=new Map()
    sheet.eachRow(row=>row.eachCell(cell=>{if(cell.formula)cells.set(cell.address,cell)}))
    for(const address of changed)cells.set(address,sheet.getCell(address))
    for(const cell of cells.values()){
      let rowNode=Array.from(doc.getElementsByTagName('row')).find(e=>Number(e.getAttribute('r'))===cell.row)
      if(!rowNode){rowNode=doc.createElementNS(NS,'row');rowNode.setAttribute('r',String(cell.row));const rows=doc.getElementsByTagName('sheetData')[0];const next=Array.from(rows.childNodes).find(e=>e.nodeType===1&&Number(e.getAttribute('r'))>cell.row);rows.insertBefore(rowNode,next||null)}
      let node=Array.from(rowNode.getElementsByTagName('c')).find(e=>e.getAttribute('r')===cell.address)
      if(!node){node=doc.createElementNS(NS,'c');node.setAttribute('r',cell.address);const next=Array.from(rowNode.getElementsByTagName('c')).find(e=>sheet.getCell(e.getAttribute('r')).col>cell.col);rowNode.insertBefore(node,next||null)}
      while(node.firstChild)node.removeChild(node.firstChild)
      const put=(name,value,parent=node)=>{const el=doc.createElementNS(NS,name);el.appendChild(doc.createTextNode(String(value)));parent.appendChild(el);return el}
      const v=cellValue(cell)
      if(v?.formula){node.removeAttribute('t');put('f',v.formula);if(typeof v.result==='string')node.setAttribute('t','str');if(typeof v.result==='boolean')node.setAttribute('t','b');put('v',typeof v.result==='boolean'?Number(v.result):v.result??'')}
      else if(typeof v==='number'){node.removeAttribute('t');put('v',v)}
      else if(typeof v==='boolean'){node.setAttribute('t','b');put('v',Number(v))}
      else {node.setAttribute('t','inlineStr');const is=doc.createElementNS(NS,'is');node.appendChild(is);put('t',v??'',is)}
    }
    const dimension=doc.getElementsByTagName('dimension')[0];if(dimension)dimension.setAttribute('ref',`A1:${sheet.getCell(Math.max(1,sheet.rowCount),Math.max(1,sheet.columnCount)).address}`)
    zip.file(part,serialize(doc))
  }
  zip.remove('xl/calcChain.xml')
  for(const rel of Array.from(rels.getElementsByTagName('Relationship')))if(rel.getAttribute('Type').endsWith('/calcChain'))rel.parentNode.removeChild(rel)
  zip.file('xl/_rels/workbook.xml.rels',serialize(rels))
  const types=xml(await zip.file('[Content_Types].xml').async('string'));for(const node of Array.from(types.getElementsByTagName('Override')))if(node.getAttribute('PartName')==='/xl/calcChain.xml')node.parentNode.removeChild(node)
  zip.file('[Content_Types].xml',serialize(types))
  // Keep all unrelated parts, including drawings/charts/macros/styles; Excel recalculates on open.
  const calc=wb.getElementsByTagName('calcPr')[0]||wb.createElementNS(NS,'calcPr');calc.setAttribute('fullCalcOnLoad','1');wb.documentElement.appendChild(calc);zip.file('xl/workbook.xml',serialize(wb))
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})
}
const engine={id:'spreadsheets',spec:{version:'0.1.1'},validate,
 async catalog(){return {modes:['create','read','edit'],chartTypes:['bar','line','pie'],schema:JSON.parse(await fs.readFile(new URL('../../schemas/start.json',import.meta.url),'utf8'))}},
 async execute(input,ctx){
  validate(input);ctx.signal.throwIfAborted();const book=new ExcelJS.Workbook();book.title=input.title
  let source
  if(input.sourcePath){source=await inputFile(input.sourcePath,['.xlsx','.csv','.tsv']);if(path.extname(source).toLowerCase()==='.xlsx'){await officeZip(source);await book.xlsx.readFile(source)}else await book.csv.readFile(source,{parserOptions:{delimiter:path.extname(source).toLowerCase()==='.tsv'?'\t':','}})}
  else for(const spec of input.sheets){const sheet=book.addWorksheet(spec.name);sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};for(const row of spec.rows)sheet.addRow(row.map(v=>primitive(v)?v:v.formula?{formula:String(v.formula).replace(/^=/,'')}:v.value));sheet.columns.forEach((col,i)=>col.width=spec.widths?.[i]||18);sheet.views=[{state:'frozen',ySplit:spec.freezeRows??1}];if(spec.header!==false){sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF176B45'}}}if(spec.filter!==false&&sheet.columnCount)sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(sheet.rowCount,1),column:sheet.columnCount}};sheet.pageSetup.printArea=`A1:${columnName(Math.max(sheet.columnCount,spec.charts?.length?sheet.columnCount+10:1))+Math.max(1,sheet.rowCount,(spec.charts?.length||0)*18)}`;spec.rows.forEach((row,r)=>row.forEach((value,c)=>{if(value&&typeof value==='object'){const cell=sheet.getCell(r+1,c+1);if(value.numFmt)cell.numFmt=value.numFmt;if(value.font)cell.font=value.font;if(value.alignment)cell.alignment=value.alignment}}))}
  book.title=input.title
  if(book.worksheets.some(s=>s.rowCount>10000||s.columnCount>200)||book.worksheets.reduce((n,s)=>n+s.rowCount*s.columnCount,0)>100000)throw new Error('工作簿超出 100000 单元格的处理上限')
  const edits=input.edits||[]
  if(input.mode==='edit'&&(!Array.isArray(edits)||!edits.length||edits.length>10000))throw new Error('请提供 1–10000 处单元格修改')
  for(const edit of edits){const sheet=book.getWorksheet(edit.sheet);if(!sheet||!/^([A-Z]{1,3})([1-9]\d{0,5})$/.test(edit.cell))throw new Error('修改的工作表或单元格无效');const cell=sheet.getCell(edit.cell);if(cell.row>10000||cell.col>200)throw new Error('修改超出 10000 行、200 列的上限');cell.value=edit.formula?{formula:edit.formula.replace(/^=/,'')}:edit.value??null}
  if(book.worksheets.reduce((n,s)=>n+s.rowCount*s.columnCount,0)>100000)throw new Error('工作簿超出 100000 单元格的处理上限')
  if(input.mode!=='read')recalculate(book)
  const output=path.join(ctx.directory,safeName(input.title)+'.xlsx'),preview=path.join(ctx.directory,'preview.html')
  if(source&&path.extname(source).toLowerCase()==='.xlsx')await fs.writeFile(output,input.mode==='read'?await fs.readFile(source):await patchImported(source,book,edits))
  else await fs.writeFile(output,await addCharts(await book.xlsx.writeBuffer(),book,input.sheets||[]))
  await fs.writeFile(preview,render(book,input.sheets))
  const data=path.join(ctx.directory,'workbook.json');await fs.writeFile(data,JSON.stringify(book.worksheets.map(s=>({name:s.name,rows:Array.from({length:s.rowCount},(_,r)=>Array.from({length:s.columnCount},(_,c)=>cellValue(s.getCell(r+1,c+1))))})),null,2))
  return {artifacts:[{name:path.basename(output),path:output,kind:'document'},{name:'表格预览',path:preview,kind:'html'},{name:'工作簿数据.json',path:data,kind:'json'}],result:{sheets:book.worksheets.map(s=>({name:s.name,rows:s.rowCount,columns:s.columnCount})),previewIndex:1},message:'工作簿已生成'}
 }}
export default creationEngine(engine,{scheme:'moss-spreadsheets',title:'表格',tools:['spreadsheet_create','spreadsheet_status','spreadsheet_read']})
