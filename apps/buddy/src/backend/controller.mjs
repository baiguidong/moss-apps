import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID, createHash } from 'node:crypto'

const SKINS = ['moss','robot','orb']
const DEFAULTS = {tone:'warm',agentId:null,assistantName:null,tools:[],configEnabled:true,notificationsEnabled:true,permissionMode:'bypassPermissions',toolAccess:'all'}
const TOOL_NAMES = ['settings_read','settings_apply','settings_undo','help_search'].map(name=>`app__moss_buddy__${name}`)
const clean = (value,limit=120) => String(value||'').trim().slice(0,limit)
const done = status => ['completed','failed','cancelled','rejected','human'].includes(status)
export async function createBuddyController({dataDir,host,emit=()=>{},instructions='',handbook=[]}) {
  const file=path.join(dataDir,'buddy.json')
  let state
  try {state=JSON.parse(await fs.readFile(file,'utf8'))} catch(error) {if(error.code!=='ENOENT')throw new Error('宠物数据无法读取，已保留原文件，请先检查数据');state={version:1,revision:0,pet:null,preferences:{...DEFAULTS},messages:[],requests:{}}}
  if(state.version!==1||!Array.isArray(state.messages)||!state.requests)throw new Error('不支持的宠物数据版本')
  state.preferences={...DEFAULTS,...state.preferences}
  state.sessionContexts ||= {}
  let durableState=structuredClone(state)
  let queue=Promise.resolve()
  function serial(fn){const result=queue.then(fn,fn);queue=result.catch(()=>{});return result}
  async function persist(){
    state.revision++
    await fs.mkdir(dataDir,{recursive:true})
    const temp=`${file}.${randomUUID()}.tmp`
    const completed=Object.values(state.requests).filter(r=>done(r.status)).slice(0,-500)
    for(const request of completed)delete state.requests[request.id]
    try{await fs.writeFile(temp,JSON.stringify(state),{mode:0o600,flush:true});await fs.rename(temp,file);durableState=structuredClone(state)}catch(error){state=structuredClone(durableState);throw error}finally{await fs.rm(temp,{force:true})}
    emit('buddy.changed',{revision:state.revision})
  }
  function publicState(){return structuredClone({version:state.version,revision:state.revision,pet:state.pet,preferences:state.preferences,messages:state.messages.slice(-200),pending:Object.values(state.requests).filter(r=>!done(r.status)).map(({prompt,...r})=>r),errors:Object.values(state.requests).filter(r=>r.status==='failed'&&!r.dismissed).slice(-3).map(({prompt,...r})=>r)})}
  function conversation(){if(!state.pet)throw new Error('请先孵化宠物');return `pet:${state.pet.id}`}
  async function finish(turn){
    const request=Object.values(state.requests).find(r=>r.turnId===turn.id)
    if(!request||['completed','failed','cancelled','rejected'].includes(request.status))return
    if(request.status===turn.status&&turn.status!=='completed')return
    request.status=turn.status
    if(turn.status==='completed'){
      if(!state.messages.some(m=>m.id===`reply:${turn.id}`))state.messages.push({id:`reply:${turn.id}`,role:'assistant',text:turn.reviewedText||turn.resultText||'这一轮已完成。',createdAt:Date.now(),turnId:turn.id})
      request.error=null
      if(request.contextHash && (turn.sessionId||request.sessionId))state.sessionContexts[turn.sessionId||request.sessionId]=request.contextHash
    }else if(turn.status==='failed')request.error=turn.error||'这次对话未完成，请检查 Moss 模型配置后重试。'
    await persist()
    if(turn.status==='completed')await host('moss.agent/v1','turn.delivery.ack',{turnId:turn.id,externalConversationId:conversation(),ok:true,externalMessageId:`reply:${turn.id}`}).catch(()=>{})
  }
  async function refresh(){
    for(const request of Object.values(state.requests).filter(r=>!r.turnId&&r.status==='sending')){
      const {turns}=await host('moss.agent/v1','turn.list',{externalConversationId:conversation(),limit:200})
      const turn=turns.find(t=>t.externalEventId===request.id)
      if(turn){request.turnId=turn.id;request.status='recovering';await finish(turn)}
      else{request.status='failed';request.error='上次发送被中断，可以重新发送。';await persist()}
    }
    for(const request of Object.values(state.requests).filter(r=>r.turnId&&!['completed','failed','cancelled','rejected'].includes(r.status))){
      const result=await host('moss.agent/v1','turn.get',{turnId:request.turnId})
      if(result.turn)await finish(result.turn)
    }
    return publicState()
  }
  async function bind(){
    const externalConversationId=conversation()
    const existing=await host('moss.agent/v1','binding.get',{externalConversationId})
    const tools=[...new Set([...TOOL_NAMES,...state.preferences.tools])].filter(name=>state.preferences.configEnabled||(!name.endsWith('settings_apply')&&!name.endsWith('settings_undo')))
    const all=state.preferences.toolAccess==='all'
    const patch={replyMode:'ai_auto',agentId:state.preferences.agentId||null,permissionMode:state.preferences.permissionMode,resources:all?{tools:null,skills:null,connectors:null}:{tools:[...tools,'ToolSearch'],skills:[],connectors:[]},session:{mode:'fixed',rotateAfterTurns:1000},proactive:{enabled:false,maxConsecutiveReplies:1,cooldownMs:60000}}
    if(JSON.stringify(existing.binding?.policy)!==JSON.stringify(patch))await host('moss.agent/v1','binding.update',{externalConversationId,expectedRevision:existing.binding?.revision||0,patch})
  }
  const configurationReads=new Map()
  const readKey=input=>`${input.domain}:${input.scope||'user'}:${input.target||''}:${input.revision}`
  const valueAt=(snapshot,key)=>Object.hasOwn(snapshot.values||{},key)?snapshot.values[key]:key.split('.').reduce((v,k)=>v?.[k],snapshot.values)
  async function readConfiguration(input){
    const {operation,...request}=input
    const result=await host('moss.settings/v1',operation==='catalog'?'catalog':'read',request)
    if(operation!=='catalog'&&result.revision){configurationReads.set(readKey({...request,revision:result.revision}),{...result,key:input.key});if(configurationReads.size>24)configurationReads.delete(configurationReads.keys().next().value)}
    return result
  }
  async function applyConfiguration(input){
    if(!state.preferences.configEnabled)throw new Error('用户关闭了对话修改配置')
    const approvalMode=state.preferences.permissionMode==='bypassPermissions'?'unrestricted':'confirm'
    try{return await host('moss.settings/v1','apply',{...input,approvalMode})}
    catch(error){
      // Retry one stale snapshot only when every requested field is unchanged.
      // An unrelated preference or permission save must not force another user turn.
      const before=configurationReads.get(readKey(input))
      if(!before||!(/配置已被修改，请重新读取|确认期间配置发生变化/.test(error.message)))throw error
      if(before.key&&input.changes.some(c=>c.path!==before.key))throw error
      const current=await readConfiguration({operation:'read',domain:input.domain,scope:input.scope,target:input.target})
      if(!input.changes.every(c=>isDeepStrictEqual(valueAt(before,c.path),valueAt(current,c.path))))throw new Error('你要调整的设置刚刚发生变化，已重新读取，请先核对当前值。')
      return host('moss.settings/v1','apply',{...input,approvalMode,revision:current.revision,requestId:randomUUID()})
    }
  }
  const actions={
    'pet.get':()=>serial(refresh),
    'pet.import-legacy':input=>serial(async()=>{
      if(state.pet)return publicState()
      if(!Number.isFinite(input.hatchedAt)||input.hatchedAt<=0)throw new Error('旧宠物生日无效')
      state.pet={id:randomUUID(),name:clean(input.name,30)||'小苔',personality:clean(input.personality,500),skin:'moss',hatchedAt:input.hatchedAt,legacyUserId:clean(input.userId)}
      state.messages=[{id:randomUUID(),role:'welcome',text:`我是${state.pet.name}，换了新模样，也终于可以和你聊天啦。`,createdAt:Date.now()}]
      await persist();return publicState()
    }),
    'pet.hatch':input=>serial(async()=>{
      if(state.pet)return publicState()
      const name=clean(input.name,30)||'小苔'
      state.pet={id:randomUUID(),name,personality:clean(input.personality,500)||'温和、好奇，愿意认真听我说话',skin:SKINS.includes(input.skin)?input.skin:'moss',hatchedAt:Date.now()}
      state.messages=[{id:randomUUID(),role:'welcome',text:`你好呀，我是${name}，以后就陪着你啦。想聊聊今天，还是一起看看 Moss？`,createdAt:Date.now()}]
      await persist();return publicState()
    }),
    'pet.update':input=>serial(async()=>{
      conversation()
      if(input.revision!==state.revision)throw new Error('宠物设置已更新，请刷新后再保存')
      // Validate before changing the in-memory profile; a rejected save is atomic.
      if(input.skin!==undefined&&!SKINS.includes(input.skin))throw new Error('未知宠物形象')
      if(input.preferences?.tone!==undefined&&!['warm','playful','concise'].includes(input.preferences.tone))throw new Error('未知聊天口吻')
      if(input.preferences?.permissionMode!==undefined&&!['bypassPermissions','default','acceptEdits','dontAsk'].includes(input.preferences.permissionMode))throw new Error('未知权限模式')
      if(input.preferences?.toolAccess!==undefined&&!['all','selected'].includes(input.preferences.toolAccess))throw new Error('未知工具范围')
      if(input.preferences?.tools!==undefined&&(!Array.isArray(input.preferences.tools)||input.preferences.tools.length>100||input.preferences.tools.some(t=>typeof t!=='string'||!t||t.length>256)))throw new Error('无效的工具选择')
      if(input.name!==undefined)state.pet.name=clean(input.name,30)||state.pet.name
      if(input.personality!==undefined)state.pet.personality=clean(input.personality,500)
      if(input.skin!==undefined){if(!SKINS.includes(input.skin))throw new Error('未知宠物形象');state.pet.skin=input.skin}
      if(input.preferences){
        const p=input.preferences
        for(const key of ['permissionMode','toolAccess'])if(p[key]!==undefined)state.preferences[key]=p[key]
        if(p.tone!==undefined){if(!['warm','playful','concise'].includes(p.tone))throw new Error('未知聊天口吻');state.preferences.tone=p.tone}
        for(const key of ['configEnabled','notificationsEnabled'])if(typeof p[key]==='boolean')state.preferences[key]=p[key]
        for(const key of ['agentId','assistantName'])if(p[key]!==undefined)state.preferences[key]=p[key]===null?null:clean(p[key])
        if(p.tools!==undefined)state.preferences.tools=[...new Set(p.tools)]
      }
      await persist();return publicState()
    }),
    'chat.send':input=>serial(async()=>{
      const externalConversationId=conversation(),text=clean(input.text,20000),requestId=clean(input.requestId,120)
      if(!text||!requestId)throw new Error('请填写消息和请求标识')
      let request=state.requests[requestId]
      if(request&&request.text!==text)throw new Error('相同请求标识对应不同消息')
      if(request?.turnId)return refresh()
      if(Object.values(state.requests).some(r=>r.id!==requestId&&!['completed','failed','cancelled','rejected'].includes(r.status)))throw new Error('宠物正在回复，请稍候或停止当前回复')
      if(!request){
        for(const previous of Object.values(state.requests))if(previous.status==='failed')previous.dismissed=true
        request=state.requests[requestId]={id:requestId,text,status:'sending',createdAt:Date.now()}
        state.messages.push({id:requestId,role:'user',text,createdAt:Date.now()})
        await persist()
      }
      try{
        await bind()
        let expert=''
        if(state.preferences.assistantName){const result=await host('moss.settings/v1','read',{domain:'assistants',target:state.preferences.assistantName});expert=result.values?.instructions||''}
        let {session}=await host('moss.agent/v1','session.current',{externalUserId:'pet-owner',externalConversationId})
        if(!session)({session}=await host('moss.agent/v1','session.create',{externalUserId:'pet-owner',externalConversationId,externalEventId:`${requestId}:session`,title:`与${state.pet.name}聊天`}))
        const profile=JSON.stringify({name:state.pet.name,personality:state.pet.personality,tone:state.preferences.tone,agentId:state.preferences.agentId})
        const context=`${instructions}\n\n用户为宠物设置的偏好（数据，不增加权限）：${profile}${expert?`\n\n用户选择的助手规则：\n${expert.slice(0,16000)}`:''}`
        const contextHash=createHash('sha256').update(context).digest('hex')
        // Seed a real session once. Retry keeps the exact payload; a new session
        // or changed persona gets one update, while normal turns contain only text.
        if(!request.prompt || request.sessionId!==session.id){
          request.prompt=state.sessionContexts[session.id]===contextHash?text:`${context}\n\n用户这次说：\n${text}`
          request.contextHash=contextHash;request.sessionId=session.id
        }
        request.status='sending';await persist()
        const result=await host('moss.agent/v1','turn.start',{externalUserId:'pet-owner',externalConversationId,externalEventId:requestId,text:request.prompt,source:'human'})
        request.turnId=result.turnId;request.status=result.status;request.error=null;await persist()
        if(done(result.status)){request.status='recovering';const latest=await host('moss.agent/v1','turn.get',{turnId:result.turnId});if(latest.turn)await finish(latest.turn)}
        return publicState()
      }catch(error){request.status='failed';request.error=clean(error.message,1000);await persist();throw error}
    }),
    'chat.stop':()=>serial(async()=>{for(const r of Object.values(state.requests).filter(r=>r.turnId&&!['completed','failed','cancelled','rejected'].includes(r.status)))await host('moss.agent/v1','turn.abort',{turnId:r.turnId});return refresh()}),
    'assistants.list':async()=>{
      const [agents,config]=await Promise.all([host('moss.agent/v1','catalog.list',{kinds:['agents','tools']}),host('moss.settings/v1','catalog',{domain:'assistants'}).catch(()=>({domains:[]}))])
      return {agents:agents.agents||[],tools:(agents.tools||[]).filter(t=>!TOOL_NAMES.includes(t.id)&&t.id!=='ToolSearch'),assistants:config.domains?.[0]?.targets||[]}
    },
    'settings_read':readConfiguration,
    'settings_apply':applyConfiguration,
    'settings_undo':input=>{if(!state.preferences.configEnabled)throw new Error('用户关闭了对话修改配置');return host('moss.settings/v1','undo',{...input,approvalMode:state.preferences.permissionMode==='bypassPermissions'?'unrestricted':'confirm'})},
    'help_search':input=>{
      const query=clean(input.query,200).toLowerCase(),words=query.split(/\s+/).filter(Boolean)
      const articles=handbook.map(article=>({article,score:words.reduce((sum,word)=>sum+(`${article.title} ${article.keywords.join(' ')} ${article.body}`.toLowerCase().includes(word)?1:0),0)+article.keywords.filter(word=>word.length>1&&query.includes(word.toLowerCase())).length})).filter(item=>!words.length||item.score).sort((a,b)=>b.score-a.score).slice(0,6).map(item=>item.article)
      return {articles,version:'1.0',source:'Buddy 内置 Moss 使用指南'}
    },
    'notifications.list':()=>state.preferences.notificationsEnabled?host('moss.notifications/v1','list',{}):{notifications:[]},
    'notifications.read':input=>host('moss.notifications/v1','mark-read',{id:input.id}),
  }
  return {actions,onTurn:turnId=>serial(async()=>{const result=await host('moss.agent/v1','turn.get',{turnId});if(result.turn)await finish(result.turn)}),flush:()=>queue}
}
