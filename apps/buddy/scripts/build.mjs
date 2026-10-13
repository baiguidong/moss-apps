import { buildAppSettings } from '@moss/app-settings/build'
import fs from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const cwd=fileURLToPath(new URL('..',import.meta.url))
await fs.rm(new URL('../dist',import.meta.url),{recursive:true,force:true})
for(const dir of ['ui','backend','resources'])await fs.mkdir(new URL(`../dist/${dir}`,import.meta.url),{recursive:true})
for(const [source,target,platform] of [['src/ui/main.mjs','dist/ui/main.mjs','browser'],['src/backend/main.mjs','dist/backend/main.mjs','node']]){
 const result=spawnSync('bun',['build',source,`--target=${platform}`,'--format=esm',`--outfile=${target}`],{cwd,stdio:'inherit'})
 if(result.error||result.status!==0)throw result.error||new Error('Buddy build failed')
}
for(const name of ['index.html','theme.css','style.css'])await fs.copyFile(new URL(`../src/ui/${name}`,import.meta.url),new URL(`../dist/ui/${name}`,import.meta.url))
await fs.cp(new URL('../resources',import.meta.url),new URL('../dist/resources',import.meta.url),{recursive:true})

await buildAppSettings(fileURLToPath(new URL('..', import.meta.url)))
