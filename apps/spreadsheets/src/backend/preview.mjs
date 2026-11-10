import fs from 'node:fs/promises'
import { htmlDocument, escapeHtml as h, jsonScript } from '@moss/creation-apps'

const columnName = number => { let name = ''; for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name }
// Keep the complete offline document below the Host's 2 MiB preview limit.
const DATA_BUDGET = 900 * 1024
export async function workbookPreview(book, specs, formatted, renderCharts) {
  let remaining = DATA_BUDGET
  const sheets = book.worksheets.map((sheet, index) => {
    const start = specs[index]?.header === false ? 1 : 2
    const columns = Array.from({ length: sheet.columnCount }, (_, c) => ({ id: 'c' + c, label: String(start === 2 ? formatted(sheet.getCell(1, c + 1), book) : columnName(c + 1)).slice(0, 256) || columnName(c + 1) }))
    const result = { name: sheet.name, columns, rows: [], total: Math.max(0, sheet.rowCount - start + 1) }
    for (let r = start; r <= sheet.rowCount; r++) {
      const row = { number: r, cells: columns.map((_, c) => {
        const cell = sheet.getCell(r, c + 1), raw = cell.formula ? cell.result : cell.value
        const text = String(formatted(cell, book))
        return [raw instanceof Date ? raw.getTime() : typeof raw === 'number' || typeof raw === 'boolean' ? raw : text, text, cell.formula || '']
      }) }
      const bytes = Buffer.byteLength(jsonScript(row))
      if (bytes > remaining) break
      result.rows.push(row); remaining -= bytes
    }
    return result
  })
  const fallback = sheets.map((sheet, index) => `<section data-sheet="${index}" ${index ? 'hidden' : ''}><h2>${h(sheet.name)}</h2>${renderCharts(book.worksheets[index], specs[index]?.charts)}<div class="static-table"><table><thead><tr>${sheet.columns.slice(0, 40).map(c => `<th>${h(c.label)}</th>`).join('')}</tr></thead><tbody>${sheet.rows.slice(0, 25).map(row => `<tr>${row.cells.slice(0, 40).map(cell => `<td title="${h(cell[2])}">${h(cell[1])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('')
  const js = await fs.readFile(new URL('../../dist/preview/table.js', import.meta.url), 'utf8')
  const html = htmlDocument(book.title || '表格', `<h1>${h(book.title || '表格')}</h1><div class="toolbar"><label>工作表 <select id="sheet">${sheets.map((s, i) => `<option value="${i}">${h(s.name)}</option>`).join('')}</select></label><label>搜索 <input id="search" type="search" maxlength="200" placeholder="搜索当前工作表"></label><details id="columns"><summary>显示列</summary><div id="column-options"></div></details><button id="reset-view" type="button">重置视图</button></div><p id="preview-limit" role="status"></p><div id="fallback">${fallback}</div><div id="interactive-table" class="table-scroll" tabindex="0" aria-label="工作表数据" hidden></div><div class="toolbar" id="pagination" hidden><button id="previous" type="button">上一页</button><span id="page-status" role="status"></span><button id="next" type="button">下一页</button><label>每页 <select id="page-size"><option>25</option><option>50</option><option>100</option></select> 行</label></div><noscript>此预览需要 JavaScript 才能搜索、排序和翻页；上方显示前 25 行、40 列，完整数据见 XLSX。</noscript><script type="application/json" id="workbook-data">${jsonScript(sheets)}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script>`, `
    body{margin:12px;font-size:14px}h1{font-size:18px;margin:0 0 10px}h2{font-size:16px;margin:10px 0}
    .toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.toolbar label{display:inline-flex;align-items:center;gap:6px}
    input,select,button,summary{font:inherit;min-height:30px;padding:4px 8px;color:inherit;background:transparent;border:1px solid light-dark(#dce2e9,#465349);border-radius:6px}input{max-width:100%;width:180px}
    button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
    .table-scroll,.static-table{max-height:65vh;overflow:auto;max-width:100%;margin:10px 0}table{width:100%;font-size:13px}td{white-space:pre-wrap;max-width:420px;overflow-wrap:anywhere}th{position:sticky;top:0;background:light-dark(#f5f7fa,#29332d);white-space:nowrap}td,th{padding:6px 8px}th button{border:0;font-weight:600;white-space:normal}td.row-number{color:light-dark(#53606c,#aab7af);width:42px}#columns{position:relative}#column-options{position:absolute;z-index:5;right:0;min-width:160px;max-width:240px;max-height:240px;overflow:auto;padding:8px;background:light-dark(#fff,#202621);border:1px solid light-dark(#dce2e9,#465349);border-radius:6px}#column-options label{display:flex;gap:8px;align-items:center;overflow-wrap:anywhere}#column-options input{width:16px;min-height:16px}#preview-limit:empty{display:none}#preview-limit{font-size:13px}figure{margin:8px 0} [hidden]{display:none!important}
  `)
  if (Buffer.byteLength(html) > 2 * 1024 ** 2) throw new Error('表格预览超过 2 MiB，请拆分工作簿或缩短单元格内容')
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`)
}
