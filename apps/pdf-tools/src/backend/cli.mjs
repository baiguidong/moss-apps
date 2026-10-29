import fs from 'node:fs'
// Discovery helper only; all mutations run through the Host-managed native tools.
console.log(JSON.stringify({tools:['pdf_import','pdf_list','pdf_create','pdf_status','pdf_export'], taskSchema:JSON.parse(fs.readFileSync(new URL('../../schemas/tasks.start.json',import.meta.url),'utf8'))}))
