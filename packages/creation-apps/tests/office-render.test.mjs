import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { renderOfficeFile } from '../src/office-render.mjs'

test('missing rendering engines and invalid files never claim visual verification',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-render-contract-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const doc=path.join(root,'input.docx');await fs.writeFile(doc,'reference remains unchanged')
 const missing=await renderOfficeFile(doc,path.join(root,'missing'),{executables:{soffice:''}})
 assert.equal(missing.result.status,'unavailable');assert.equal(missing.result.visuallyVerified,false);assert.deepEqual(missing.files,[])
 assert.equal(await fs.readFile(doc,'utf8'),'reference remains unchanged')
 const pdf=path.join(root,'input.pdf');await fs.writeFile(pdf,'%PDF-reference')
 const noImages=await renderOfficeFile(pdf,path.join(root,'no-images'),{executables:{pdftoppm:'',pdfinfo:''}})
 assert.equal(noImages.result.status,'pdf-only');assert.deepEqual(noImages.result.pages,[])
 const failed=await renderOfficeFile(path.join(root,'absent.docx'),path.join(root,'failed'))
 assert.equal(failed.result.status,'failed');assert.equal(failed.result.visuallyVerified,false)
 const controller=new AbortController();controller.abort(new Error('user canceled'))
 await assert.rejects(renderOfficeFile(doc,path.join(root,'canceled'),{signal:controller.signal}),/user canceled/)
 await assert.rejects(renderOfficeFile(path.join(root,'file.exe'),root),/不支持/)
})

test('batch state survives interruption, resumes missing pages and rejects stale source',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'moss-render-resume-'));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const pdf=path.join(root,'input.pdf'),directory=path.join(root,'pages');await fs.writeFile(pdf,'%PDF-test-fixture')
 const info=path.join(root,'pdfinfo'),ppm=path.join(root,'pdftoppm'),failure=path.join(root,'fail')
 await fs.writeFile(info,`#!${process.execPath}\nconsole.log('Pages: 105')\n`,{mode:0o755})
 await fs.writeFile(ppm,`#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2),page=+a[a.indexOf('-f')+1];if(page===3&&fs.existsSync(${JSON.stringify(failure)}))process.exit(1);fs.writeFileSync(a.at(-1)+'.png','fake page '+page);\n`,{mode:0o755})
 await fs.writeFile(failure,'fail once')
 const options={executables:{pdfinfo:info,pdftoppm:ppm},maxPages:5}
 const first=await renderOfficeFile(pdf,directory,options);assert.equal(first.result.status,'partial');assert.deepEqual(first.result.pages.map(p=>p.page),[1,2]);assert.equal(first.result.nextPage,3)
 const stamp=(await fs.stat(first.result.pages[0].path)).mtimeMs;await fs.rm(failure)
 const resumed=await renderOfficeFile(pdf,directory,options);assert.equal(resumed.result.pages.length,7);assert.equal(resumed.result.nextPage,8);assert.equal((await fs.stat(first.result.pages[0].path)).mtimeMs,stamp)
 const late=await renderOfficeFile(pdf,directory,{...options,startPage:101});assert.deepEqual(late.result.pages.slice(-5).map(p=>p.page),[101,102,103,104,105]);assert.equal(late.result.nextPage,8)
 await fs.rm(late.result.pages[1].path)
 const missing=await renderOfficeFile(pdf,directory,{...options,maxPages:1});assert.equal(missing.result.pages[1].page,2);assert.equal(missing.result.nextPage,8)
 let completed=missing
 while(completed.result.nextPage)completed=await renderOfficeFile(pdf,directory,{...options,maxPages:20})
 assert.equal(completed.result.status,'rendered');assert.equal(completed.result.pages.length,105);assert.equal(completed.result.visuallyVerified,false)
 await fs.appendFile(pdf,'changed');const stale=await renderOfficeFile(pdf,directory,options);assert.equal(stale.result.status,'failed');assert.equal(stale.result.pages.length,0)
})

test('a restarted host resumes legacy cached pages through a different directory alias', async t => {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'moss-render-alias-')));t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const alias=path.join(root,'alias');await fs.symlink(root,alias,'dir')
 const source=path.join(root,'input.pdf'),directory=path.join(root,'pages'),info=path.join(root,'pdfinfo'),ppm=path.join(root,'pdftoppm')
 await fs.writeFile(source,'%PDF-fixture')
 await fs.writeFile(info,`#!${process.execPath}\nconsole.log('Pages: 4')\n`,{mode:0o755})
 await fs.writeFile(ppm,`#!${process.execPath}\nrequire('node:fs').writeFileSync(process.argv.at(-1)+'.png','rendered page');\n`,{mode:0o755})
 const options={maxPages:2,executables:{pdfinfo:info,pdftoppm:ppm}}
 const first=await renderOfficeFile(source,directory,options),mtime=(await fs.stat(first.result.pages[0].path)).mtimeMs
 const saved=JSON.parse(await fs.readFile(path.join(directory,'render-state.json'),'utf8'))
 saved.pdfPath=path.join(alias,'input.pdf');saved.pages=saved.pages.map(p=>({...p,path:path.join(alias,'pages',path.basename(p.path))}))
 await fs.writeFile(path.join(directory,'render-state.json'),JSON.stringify(saved))
 const resumed=await renderOfficeFile(path.join(alias,'input.pdf'),path.join(alias,'pages'),{...options,startPage:3})
 assert.equal(resumed.result.status,'rendered');assert.deepEqual(resumed.result.pages.map(p=>p.page),[1,2,3,4]);assert.equal((await fs.stat(resumed.result.pages[0].path)).mtimeMs,mtime)
 assert.equal(resumed.result.visuallyVerified,false)
})
