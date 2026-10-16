import test from 'node:test'
import assert from 'node:assert/strict'
import engine,{unpack} from '../src/backend/engine.mjs'
test('MCP envelopes preserve structured graph data and readable source',async()=>{
 const graph={cols:['name'],groups:[{qn_prefix:'repo',rows:[['sum']]}]}
 assert.deepEqual(unpack({structuredContent:graph,content:[]}),graph)
 assert.deepEqual(unpack({content:[{type:'text',text:JSON.stringify(graph)}]}),graph)
 assert.deepEqual(unpack({content:[{type:'text',text:'source: return 1'}]}),{text:'source: return 1'})
 await assert.rejects(engine.validate({tool:'search_graph',arguments:'{}'}),/参数对象/)
 await engine.validate({tool:'search_graph',arguments:{project:'repo',limit:30}})
})
