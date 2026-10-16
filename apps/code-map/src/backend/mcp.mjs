import path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { TaskStore, executeTask } from '@moss/engine-apps/runtime'
import engine from './engine.mjs'
const index=process.argv.indexOf('--data-dir'),dataDir=process.argv[index+1]
if(index<0||!path.isAbsolute(dataDir||''))throw new Error('Missing App --data-dir')
const store=new TaskStore(dataDir)
const server=new Server({name:'moss-code-map',version:'0.1.0'},{capabilities:{tools:{}}})
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:(await engine.catalog({dataDir})).tools}))
server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
  const input={tool:request.params.name,arguments:request.params.arguments||{}}
  await engine.validate(input)
  const task=await executeTask(engine,store,await store.create(input,'agent-tool'),extra.signal)
  return task.status==='succeeded'?task.raw:{isError:true,content:[{type:'text',text:JSON.stringify({taskId:task.id,error:task.message})}]}
})
const close=async()=>{await server.close();await engine.close()}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());process.stdin.once('end',()=>void close())
await server.connect(new StdioServerTransport())
