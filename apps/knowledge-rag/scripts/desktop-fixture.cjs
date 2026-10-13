const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { createHash } = require('node:crypto')
const core = process.env.MOSS_CORE_ROOT, repo = process.env.MOSS_APPS_ROOT
let runtime, mcpHost, temporary, picker = [], closed = false
const windows = new Map(), changes = []
app.on('window-all-closed', () => {})
async function cleanup() { if (!closed) { closed = true; for(const {window} of windows.values())if(!window.isDestroyed())window.destroy(); await runtime?.shutdown() } }
;(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(),'moss-rag-desktop-'))
  await fs.mkdir(path.join(temporary,'profile'))
  app.setPath('userData',path.join(temporary,'profile'))
  await app.whenReady()
  console.log('Desktop fixture: Electron ready')
  const load = relative => import(pathToFileURL(path.join(core,relative)))
  const { createAppRuntime, installAppArchive } = await load('ui/src/apps/app-runtime.mjs')
  const { AppMcpHost, createMcpProtocolDefinition } = await load('ui/src/apps/app-mcp-host.mjs')
  const { registerAppUiRequests } = await load('ui/src/apps/app-ui-requests.mjs')
  const local = await load('ui/src/apps/app-local-host.mjs')
  const { writePackageChecksums } = await load('packages/app-runtime/src/index.mjs')
  const { connectEngine } = await import(pathToFileURL(path.join(repo,'apps/knowledge-rag/src/backend/mcp.mjs')))
  mcpHost = new AppMcpHost({ getRuntime:()=>runtime, onChanged:()=>({resetSessionCount:0,skippedBusySessionCount:0}),
    inspect:async(_name,config)=>{
      const connection=await connectEngine(config.url,config.headers.Authorization.slice(7))
      try{return {state:'connected',tools:(await connection.client.listTools()).tools.map(tool=>({name:tool.name,description:tool.description||'',disabled:false})),checkedAt:Date.now()}}
      finally{await connection.close()}
    },reservedName:()=>false,
  })
  const mossHome=path.join(temporary,'moss'), ragId='moss.knowledge-rag', libraryId='moss.library'
  const ragData=path.join(mossHome,'apps-data',ragId,'instances',`${ragId}--default`)
  await fs.mkdir(path.join(ragData,'engine'),{recursive:true})
  const cache=path.join(repo,'.cache/knowledge-rag')
  const requirementsSha256=createHash('sha256').update(await fs.readFile(path.join(repo,'apps/knowledge-rag/resources/requirements.lock'))).digest('hex')
  await fs.writeFile(path.join(cache,'venv/ready.json'),JSON.stringify({version:'4.11.0',requirementsSha256}))
  await fs.symlink(path.join(cache,'venv'),path.join(ragData,'python-env'))
  await fs.symlink(path.join(cache,'models'),path.join(ragData,'engine/models'))
  runtime=await createAppRuntime({mossHome,nodeExecutable:process.env.MOSS_TEST_NODE,
    onCreated:value=>{runtime=value},
    hostProtocols:[local.createLocalFilesProtocolDefinition(),local.createRuntimesProtocolDefinition(),createMcpProtocolDefinition()],
    hostHandlers:{...local.createLocalAppHostHandlers({dialog:{showOpenDialog:async()=>({canceled:!picker.length,filePaths:picker})},shell:{openPath:async()=>'',showItemInFolder(){}},getManagedRuntimeStatus:()=>({python:{installed:true,path:process.env.MOSS_TEST_PYTHON}})}),
      'moss.mcp/v1':Object.fromEntries(['servers.list','servers.save','servers.remove','servers.set-enabled','servers.inspect','auth.start','auth.clear'].map(name=>[name,(input,context)=>mcpHost.handle(name,input,context)]))},
    onEvent:event=>{
      if(event.type==='tool-scope-changed')changes.push({appId:event.appId,scope:runtime.getToolScope(event.appId,'session')})
      for(const [id,state] of windows)if(state.id===event.appId&&!state.window.isDestroyed()){
        state.window.webContents.send('app-ui:event:runtime',event)
        if(event.type==='backend-event')state.window.webContents.send(`app-ui:event:${event.name}`,event.data)
      }
    },
  })
  console.log('Desktop fixture: Runtime ready')
  await installAppArchive(runtime,path.join(repo,'artifacts/moss.knowledge-rag/0.1.1/moss.knowledge-rag-0.1.1.zip'))
  console.log('Desktop fixture: RAG installed')
  const libraryPackage=path.join(temporary,'library-package');await fs.mkdir(libraryPackage)
  for(const name of ['app.moss.json','dist','schemas','assets'])await fs.cp(path.join(repo,'apps/library',name),path.join(libraryPackage,name),{recursive:true})
  await writePackageChecksums(libraryPackage);await runtime.installFromDirectory(libraryPackage)
  console.log('Desktop fixture: Library installed')
  const stateFor=sender=>{const state=windows.get(sender.id);if(!state)throw new Error('Unknown App renderer');return {...state,runtime}}
  registerAppUiRequests({ipc:ipcMain,getState:stateFor})
  ipcMain.handle('app-ui:get-info',event=>({id:stateFor(event.sender).id,appearance:{themeMode:'light',cssThemeId:'default'}}))
  ipcMain.handle('app-ui:get-installation-state',event=>runtime.getApp(stateFor(event.sender).id))
  ipcMain.handle('app-ui:get-status',event=>runtime.getApp(stateFor(event.sender).id))
  const corpus=JSON.parse(await fs.readFile(path.join(repo,'apps/knowledge-rag/tests/comparison-corpus.json'),'utf8'))
  const corpusDir=path.join(temporary,'corpus');await fs.mkdir(corpusDir)
  for(const doc of corpus.documents)await fs.writeFile(path.join(corpusDir,doc.file),doc.content)
  const invoke=(id,name,input={})=>runtime.invoke(id,`${id}--default`,name,input,{timeoutMs:300000})
  const collection=(await invoke(libraryId,'collections.list')).data[0]
  await invoke(libraryId,'files.import',{collectionId:collection.id,paths:corpus.documents.map(doc=>path.join(corpusDir,doc.file))})
  console.log('Desktop fixture: Library corpus imported')
  for(const id of [ragId,libraryId]){
    const pkg=await runtime.getActivePackage(id)
    const window=new BrowserWindow({width:1160,height:780,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:false,preload:path.join(core,'ui/src/apps/app-preload.mjs')}})
    windows.set(window.webContents.id,{id,window})
    await window.loadFile(path.join(pkg.root,pkg.manifest.ui.entry))
  }
  globalThis.ragFixture={temporary,runtime,mcpHost,changes,
    setPicker:()=>{picker=corpus.documents.map(doc=>path.join(corpusDir,doc.file))},
    scope:()=>runtime.getToolScope(ragId,'session'),
    servers:ids=>Object.keys(mcpHost.enabledServers(ids)),
    inspect:()=>{const {appId,instanceId,name,revision}=mcpHost.toolCatalog(ragId)[0];return mcpHost.inspectTools({appId,instanceId,name,revision})},
    restart:()=>runtime.restartInstance(ragId,`${ragId}--default`),
    invoke:(name,input)=>invoke(ragId,name,input),
    windowId:id=>[...windows.values()].find(state=>state.id===id)?.window.id,
    cleanup,
  }
})().catch(error=>{console.error(error);app.exit(1)})
app.on('before-quit',()=>void cleanup())
