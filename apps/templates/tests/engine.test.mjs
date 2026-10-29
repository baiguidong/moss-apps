import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fixture } from '@moss/creation-apps/testing'
import engine from '../src/backend/engine.mjs'
import { JSZip } from '@moss/creation-apps/office'
test('save/apply/update retains the original, validates placeholders and resolves persistent references',async t=>{
 const f=await fixture(t,engine),saved=await f.run({title:'周报模板',content:'# {{标题}}\n\n{{正文}}',instructions:'简明说明本周进度'})
 assert.equal(saved.result.skillBundle.installed,false)
 const skill=await fs.readFile(path.join(saved.result.skillBundle.path,'SKILL.md'),'utf8')
 assert.match(skill,/assets\/reference.md/);assert.ok(!skill.includes(f.root))
 const zip=await JSZip.loadAsync(await fs.readFile(saved.result.skillBundle.archivePath))
 assert.ok(zip.file(saved.result.skillBundle.name+'/SKILL.md'))
 assert.match(await zip.file(saved.result.skillBundle.name+'/assets/reference.md').async('string'),/\{\{标题\}\}/)
 const used=await f.run({title:'本周周报',mode:'use',templateId:saved.id,values:{标题:'本周成果',正文:'完成发布'}})
 assert.equal(await fs.readFile(used.result.referencePath,'utf8'),'# 本周成果\n\n完成发布')
 assert.match(await fs.readFile(saved.result.referencePath,'utf8'),/\{\{标题\}\}/)
 const bad=await f.run({title:'未填写',mode:'use',templateId:saved.id,values:{标题:'缺正文'}},false);assert.match(bad.message,/变量未填写/)
 const update=await f.run({title:'周报模板新版',mode:'update',templateId:saved.id,parentId:saved.id,instructions:'增加下一步计划'})
 assert.equal(update.result.skillBundle.name,saved.result.skillBundle.name);assert.equal(used.result.skillBundle,undefined)
 assert.equal(update.result.version,2);assert.equal(update.result.workId,saved.id)
 assert.equal((await f.actions.get('composer.resolve')({uri:update.result.resourceUri})).presentation.type,'interactive-html')
 const ref=path.join(f.root,'reference.pdf');await fs.writeFile(ref,'%PDF-1.7\nreference')
 const pdf=await f.run({title:'报告参考',sourcePath:ref});await fs.rm(ref)
 const handoff=await f.run({title:'报告复用',mode:'use',templateId:pdf.id});assert.equal(handoff.result.nextApp,'moss.pdf');assert.match(await fs.readFile(handoff.result.referencePath,'utf8'),/%PDF/)
})

test('invalid skill names and descriptions fail before a task writes files',()=>{
 for(const skillName of ['../escape','UPPER','',12,'a'.repeat(65)])assert.throws(()=>engine.validate({title:'模板',content:'test',skillName}))
 assert.throws(()=>engine.validate({title:'模板',content:'test',skillDescription:''}))
})

test('updates inherit the skill description, including legacy tasks, unless explicitly replaced',async t=>{
 const f=await fixture(t,engine),description='仅在用户请求生成欧盟增值税发票时使用，不用于普通收据。'
 const saved=await f.run({title:'发票模板',content:'发票 {{编号}}',skillName:'invoice-template',skillDescription:description})
 const update=async task=>f.run({title:'新版发票模板',mode:'update',templateId:task.id,instructions:'更新页眉'})
 const check=async(task,expected)=>{
  assert.equal(task.result.template.skillDescription,expected)
  assert.equal(task.result.skillBundle.description,expected)
  assert.equal(JSON.parse(await fs.readFile(path.join(f.store.directory(task.id),'template.json'),'utf8')).skillDescription,expected)
  assert.ok((await fs.readFile(path.join(task.result.skillBundle.path,'SKILL.md'),'utf8')).includes('description: '+JSON.stringify(expected)))
 }
 await check(await update(saved),description)
 // v0.2.0 persisted custom descriptions only in the original input and bundle.
 delete saved.result.template.skillDescription;await f.store.write(saved)
 await check(await update(saved),description)
 delete saved.input.skillDescription;await f.store.write(saved)
 await check(await update(saved),description)
 const replacement='仅用于年度增值税汇总报表。'
 const replaced=await f.run({title:'汇总模板',mode:'update',templateId:saved.id,skillDescription:replacement})
 await check(replaced,replacement)
 await check(await update(replaced),replacement)
 assert.equal((await f.store.get(saved.id)).result.skillBundle.description,description)
})
