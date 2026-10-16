import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createMcpClient } from '@moss/app-sdk/mcp'
import { ensureBinary } from '@moss/engine-apps/runtime'
import spec from '../../resources/engine.json' with {type:'json'}

let connection, connectedDir
export async function runtimeDirectory(dataDir) {
  // UI and Agent for one instance share a daemon; other CBM installations keep theirs.
  // A short private path also respects macOS's Unix socket path limit.
  const key = createHash('sha256').update(await fs.realpath(dataDir)).digest('hex').slice(0, 16)
  const root = path.join(process.platform === 'darwin' ? '/private/tmp' : '/tmp', `moss-cbm-${process.getuid()}-${key}`)
  await fs.mkdir(root, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error })
  const stat = await fs.lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('代码索引运行目录权限无效')
  return root
}
async function client(dataDir) {
  if(connection&&connectedDir===dataDir)return connection
  if(connection)throw new Error('同一进程不能切换索引目录')
  connectedDir=dataDir
  connection=(async()=>{
    const binary=await ensureBinary(spec,dataDir)
    await fs.mkdir(dataDir,{recursive:true})
    const transport=new StdioClientTransport({command:binary,args:['--ui=false'],cwd:dataDir,env:{...process.env,CBM_CACHE_DIR:path.join(dataDir,'index'),CBM_RUNTIME_DIR:await runtimeDirectory(dataDir)},stderr:'pipe'})
    transport.stderr?.resume()
    const instance=new Client({name:'moss-code-map',version:'0.1.0'})
    await instance.connect(transport)
    transport.stderr?.resume()
    return {instance,transport}
  })().catch(error=>{connection=null;throw error})
  return connection
}
export function unpack(result){
  if(result.structuredContent)return result.structuredContent
  const text=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')
  try{return JSON.parse(text)}catch{return {text}}
}
export default {
  id:'codebase-memory-mcp',spec,
  async catalog({dataDir}){const {instance}=await client(dataDir);const {tools}=await instance.listTools();return {version:spec.version,tools}},
  async register(backend,context){
    // Start the shared upstream daemon before exposing a second MCP client to
    // Host discovery. Simultaneous cold starts can leave one client waiting.
    await client(context.dataDir)
    const mcp=createMcpClient(backend.host),name='code-map'
    const config={type:'stdio',command:process.execPath,args:[fileURLToPath(new URL('./mcp.mjs',import.meta.url)),'--data-dir',context.dataDir],...(process.versions.electron?{env:{ELECTRON_RUN_AS_NODE:'1'}}:{})}
    const existing=(await mcp.request('servers.list',{})).servers.find(s=>s.name===name)
    if(!existing||JSON.stringify(existing.config)!==JSON.stringify(config))await mcp.request('servers.save',{name,...(existing?{previousName:name}:{}),enabled:existing?.enabled??true,config})
  },
  async validate(input){if(!input||typeof input.tool!=='string'||!input.tool||!input.arguments||typeof input.arguments!=='object'||Array.isArray(input.arguments))throw new Error('请选择 MCP 工具并填写参数对象')},
  async execute(input,ctx){
    const {instance}=await client(ctx.dataDir)
    await ctx.progress(`正在调用 ${input.tool}`)
    const raw=await instance.callTool({name:input.tool,arguments:input.arguments},undefined,{signal:ctx.signal,timeout:300000,resetTimeoutOnProgress:true,maxTotalTimeout:900000})
    const file=path.join(ctx.directory,'result.json');await fs.writeFile(file,JSON.stringify(raw,null,2))
    const result=unpack(raw)
    if(raw.isError)throw Object.assign(new Error(typeof result.text==='string'?result.text:JSON.stringify(result)),{result:raw})
    return {message:'查询完成',result,raw,artifacts:[{name:'MCP 结果.json',path:file,kind:'json'}]}
  },
  async close(){const current=connection;connection=null;if(current){const {instance}=await current.catch(()=>({}));await instance?.close()}},
}
