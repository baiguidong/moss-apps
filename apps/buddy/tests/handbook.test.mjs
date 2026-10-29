import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {searchHandbook} from '../src/backend/handbook.mjs'
import {createBuddyController} from '../src/backend/controller.mjs'

const handbook=JSON.parse(await fs.readFile(new URL('../resources/handbook.json',import.meta.url),'utf8'))

test('natural configuration requests find the relevant guidance first',()=>{
  for(const [query,id] of [
    ['刚开始用 Moss，能帮我做什么','moss-start'],
    ['字太小，帮我调大一点','appearance-adjustment'],
    ['怎么把桌面改成深色','desktop-and-terminal'],
    ['Tavily API Key 之前配置过，为什么不见了','web-search'],
    ['为什么未向模型暴露 WebSearch','web-search'],
    ['联网搜索用不了，帮我检查并修好','web-search'],
    ['配置没生效怎么办','undo'],
    ['请撤销刚才的调整','undo'],
    ['只调整当前项目的设置','configuration-scope'],
    ['如何使用 SDK 调用 Host API','app-development'],
  ]) assert.equal(searchHandbook(handbook,query)[0]?.id,id,query)
})

test('unknown topics stay empty instead of matching every article mentioning Moss',()=>{
  assert.deepEqual(searchHandbook(handbook,'Moss 没有声音怎么办'),[])
  assert.deepEqual(searchHandbook(handbook,'Moss quantum-entanglement'),[])
  assert.deepEqual(searchHandbook(handbook,'themed'),[])
  assert.equal(searchHandbook(handbook,'THEME')[0]?.id,'desktop-and-terminal')
})

test('handbook browsing remains bounded and does not mutate the source',()=>{
  const original=structuredClone(handbook)
  assert.deepEqual(searchHandbook(handbook,''),handbook.slice(0,6))
  assert.deepEqual(searchHandbook(handbook,'Moss'),handbook.slice(0,6))
  assert.ok(searchHandbook(handbook,'配置').length<=6)
  assert.deepEqual(handbook,original)
})

test('public help action uses the installed guide version and requires no settings access',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'buddy-guide-'))
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}))
  const {actions}=await createBuddyController({dataDir,handbook,handbookVersion:'0.1.5',host:async()=>{throw new Error('Help must not request configuration permissions')}})
  const result=await actions.help_search({query:'帮我把字体调大一点'})
  assert.equal(result.articles[0].id,'appearance-adjustment')
  assert.equal(result.version,'0.1.5')
})
