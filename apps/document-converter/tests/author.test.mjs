import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAuthor } from '../src/backend/engine.mjs'

test('authoring validates content, title and formats before admitting a task',()=>{
  validateAuthor({title:'中文报告',content:'# 成果\n\n|项目|数量|\n|---|---|\n|完成|3|',to:'docx'})
  for(const input of [{title:'报告',content:''},{title:'',content:'正文'},{title:'报告',content:'正文',to:'bad'},{title:'报告',content:'文'.repeat(400000)}])assert.throws(()=>validateAuthor(input))
})
