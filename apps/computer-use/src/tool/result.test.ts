import { test, expect } from 'bun:test'
import { normalizeResult } from './result.mjs'
test('preserves structured AX hierarchy and image blocks without duplicate Markdown', () => {
  const element = { element_token:'s00000001:1',role:'AXSlider',enabled:false,min:0,max:100,parent_index:1,depth:2,selected:false }
  const state = { elements:[element],snapshot_id:'s00000001',tree_markdown:'- slider',truncated:true,elements_complete:false }
  const result = normalizeResult({ structuredContent:state,content:[{type:'text',text:JSON.stringify(state)},{type:'text',text:'- slider'},{type:'text',text:'Extra context'},{type:'image',mimeType:'image/png',data:'base64'}] })
  expect(result.format).toBe('moss.tool-result/v1')
  expect(result.content).toHaveLength(3)
  expect(JSON.parse(result.content[0].text)).toEqual({ elements:[element],snapshot_id:'s00000001',truncated:true,elements_complete:false })
  expect(result.content[2]).toEqual({type:'image',mimeType:'image/png',data:'base64'})
})
test('retains AX-only fallbacks and error evidence', () => {
  const state = { elements:[],tree_markdown:'- fallback',effect:'unverifiable' }
  const result = normalizeResult({structuredContent:state,content:[{type:'text',text:'- fallback'}]})
  expect(result.content).toHaveLength(1)
  expect(JSON.parse(result.content[0].text)).toEqual(state)
  const error = normalizeResult({isError:true,structuredContent:{effect:'refused'},content:[{type:'text',text:'Observe again'}]})
  expect(error.isError).toBe(true)
  expect(error.content[1].text).toBe('Observe again')
})
