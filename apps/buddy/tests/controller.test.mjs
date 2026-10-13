import {validateAgentHostInput} from '@moss/app-sdk'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createBuddyController} from '../src/backend/controller.mjs'

async function fixture(t){
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'moss-buddy-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}))
 const calls=[],turns=[];let binding=null,session=null
 const host=async(protocol,method,input)=>{
  if(protocol==='moss.agent/v1')validateAgentHostInput(method,input)
  calls.push({protocol,method,input})
  if(method==='session.current')return {session}
  if(method==='session.create'){session={id:`session-${calls.length}`};return {session}}
  if(method==='binding.get')return {binding}
  if(method==='binding.update'){binding={...input.patch,revision:(binding?.revision||0)+1};return {binding}}
  if(method==='turn.start'){let turn=turns.find(t=>t.externalEventId===input.externalEventId);if(!turn){turn={id:`turn-${turns.length}`,status:'queued',sessionId:session.id,externalEventId:input.externalEventId};turns.push(turn)};return {turnId:turn.id,status:turn.status,sessionId:turn.sessionId}}
  if(method==='turn.get')return {turn:turns.find(t=>t.id===input.turnId)}
  if(method==='turn.list')return {turns}
  if(method==='turn.abort'){turns.find(t=>t.id===input.turnId).status='cancelled';return {}}
  if(method==='turn.delivery.ack')return {}
  if(method==='catalog.list')return {agents:[],tools:[]}
  if(method==='catalog')return {domains:[]}
  return {status:'saved'}
 }
 const make=()=>createBuddyController({dataDir,host,instructions:'Buddy instructions',handbook:[]})
 const controller=await make()
 return {dataDir,calls,turns,controller,restart:make,host}
}
test('hatch is local/idempotent; appearance and name changes retain birthday, identity and chat',async t=>{
 const f=await fixture(t),a=f.controller.actions
 const born=await a['pet.hatch']({name:'苔苔',skin:'robot'});assert.equal(f.calls.length,0)
 assert.deepEqual(await a['pet.hatch']({name:'another'}),born)
 const changed=await a['pet.update']({revision:born.revision,name:'小苔',skin:'orb'})
 assert.equal(changed.pet.id,born.pet.id);assert.equal(changed.pet.hatchedAt,born.pet.hatchedAt);assert.deepEqual(changed.messages,born.messages)
 const restarted=await f.restart();assert.deepEqual(await restarted.actions['pet.get'](),changed)
})
test('real Host turns bind the default assistant, deduplicate replies and keep conversation across sends',async t=>{
 const f=await fixture(t),a=f.controller.actions;await a['pet.hatch']({})
 const first=await a['chat.send']({text:'你好',requestId:'first'});assert.equal(first.pending.length,1)
 await a['chat.send']({text:'你好',requestId:'first'});assert.equal(f.turns.length,1)
 const binding=f.calls.find(c=>c.method==='binding.update').input.patch;assert.equal(binding.permissionMode,'bypassPermissions');assert.deepEqual(binding.resources,{tools:null,skills:null,connectors:null})
 f.turns[0].status='completed';f.turns[0].resultText='模型的真实返回'
 await f.controller.onTurn(f.turns[0].id);await f.controller.onTurn(f.turns[0].id)
 const result=await a['pet.get']();assert.equal(result.messages.filter(m=>m.role==='assistant').length,1);assert.equal(result.messages.at(-1).text,'模型的真实返回');assert.equal(result.pending.length,0)
 await a['chat.send']({text:'你记得刚才吗',requestId:'second'})
 const starts=f.calls.filter(c=>c.method==='turn.start');assert.equal(starts[0].input.externalConversationId,starts[1].input.externalConversationId);assert.ok(starts[0].input.text.includes('Buddy instructions'));assert.equal(starts[1].input.text,'你记得刚才吗')
})
test('reconciles an accepted turn after a crash before persisting its id',async t=>{
 const f=await fixture(t),a=f.controller.actions;await a['pet.hatch']({});await a['chat.send']({text:'hi',requestId:'request'})
 const file=path.join(f.dataDir,'buddy.json'),data=JSON.parse(await fs.readFile(file,'utf8'));delete data.requests.request.turnId;data.requests.request.status='sending';await fs.writeFile(file,JSON.stringify(data))
 f.turns[0].status='completed';f.turns[0].resultText='recovered'
 const restarted=await f.restart(),result=await restarted.actions['pet.get']();assert.equal(result.pending.length,0);assert.equal(result.messages.at(-1).text,'recovered');assert.equal(f.turns.length,1)
})
test('legacy migration retains birthday and cannot overwrite an existing pet',async t=>{
 const f=await fixture(t),a=f.controller.actions;const imported=await a['pet.import-legacy']({name:'老伙伴',personality:'好奇',hatchedAt:123456789,userId:'old-id'})
 assert.equal(imported.pet.hatchedAt,123456789)
 assert.deepEqual(await a['pet.import-legacy']({name:'wrong',hatchedAt:1}),imported)
})
test('disabled configuration is enforced by the backend and cancelled turns can send again',async t=>{
 const f=await fixture(t),a=f.controller.actions;const state=await a['pet.hatch']({})
 await a['pet.update']({revision:state.revision,preferences:{configEnabled:false,tools:['Read'],toolAccess:'selected',permissionMode:'default'}})
 await assert.rejects(()=>a.settings_apply({}),/关闭/);assert.throws(()=>a.settings_undo({}),/关闭/)
 await a['chat.send']({text:'hello',requestId:'one'})
 const bound=f.calls.find(c=>c.method==='binding.update').input.patch;assert.ok(bound.resources.tools.includes('Read'));assert.ok(!bound.resources.tools.includes('app__moss_buddy__settings_apply'))
 assert.equal((await a['chat.stop']()).pending.length,0);await a['chat.send']({text:'again',requestId:'two'});assert.equal(f.turns.length,2)
})

test('session context survives restart; changed preferences and replacement sessions get one update',async t=>{
 const f=await fixture(t);await f.controller.actions['pet.hatch']({})
 const complete=async controller=>{const turn=f.turns.at(-1);turn.status='completed';turn.resultText='ok';await controller.onTurn(turn.id)}
 await f.controller.actions['chat.send']({text:'first',requestId:'one'});await complete(f.controller)
 const restarted=await f.restart();await restarted.actions['chat.send']({text:'second',requestId:'two'});await complete(restarted)
 assert.equal(f.calls.filter(c=>c.method==='turn.start').at(-1).input.text,'second')
 const state=await restarted.actions['pet.get']();await restarted.actions['pet.update']({revision:state.revision,name:'小圆',preferences:{tone:'concise'}})
 await restarted.actions['chat.send']({text:'third',requestId:'three'});await complete(restarted)
 assert.match(f.calls.filter(c=>c.method==='turn.start').at(-1).input.text,/小圆/)
 await restarted.actions['chat.send']({text:'fourth',requestId:'four'});await complete(restarted)
 assert.equal(f.calls.filter(c=>c.method==='turn.start').at(-1).input.text,'fourth')
 await f.host('moss.agent/v1','session.create',{externalUserId:'pet-owner',externalEventId:'replacement'})
 await restarted.actions['chat.send']({text:'new session',requestId:'five'})
 assert.match(f.calls.filter(c=>c.method==='turn.start').at(-1).input.text,/Buddy instructions/)
})
test('execution mode is configurable and forwarded to configuration writes',async t=>{
 const f=await fixture(t),a=f.controller.actions;let state=await a['pet.hatch']({})
 await a.settings_apply({domain:'desktop'});assert.equal(f.calls.at(-1).input.approvalMode,'unrestricted')
 state=await a['pet.update']({revision:state.revision,preferences:{permissionMode:'default'}})
 await a.settings_apply({domain:'desktop'});assert.equal(f.calls.at(-1).input.approvalMode,'confirm')
 await assert.rejects(a['pet.update']({revision:state.revision,preferences:{permissionMode:'invalid'}}),/权限模式/)
})

test('stale configuration retries only if the requested field has not changed',async t=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'buddy-config-retry-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}))
 let revision='one',enabled=false,attempts=[]
 const host=async(_protocol,method,input)=>{
  if(method==='read')return {revision,values:{enabled}}
  if(method==='apply'){attempts.push(input);if(input.revision!==revision)throw new Error('配置已被修改，请重新读取');enabled=input.changes[0].value;return {status:'saved'}}
 }
 const {actions}=await createBuddyController({dataDir,host})
 await actions.settings_read({operation:'read',domain:'desktop'})
 revision='two'
 await actions.settings_apply({domain:'desktop',revision:'one',requestId:'retry',changes:[{path:'enabled',value:true}]})
 assert.equal(attempts.length,2);assert.equal(attempts[1].revision,'two');assert.notEqual(attempts[1].requestId,'retry');assert.equal(enabled,true)
 await actions.settings_read({operation:'read',domain:'desktop'})
 revision='three';enabled=false
 await assert.rejects(actions.settings_apply({domain:'desktop',revision:'two',requestId:'conflict',changes:[{path:'enabled',value:false}]}),/核对当前值/)
 assert.equal(attempts.length,3)
})
