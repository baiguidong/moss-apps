import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { prepareBinary } from './src/download.mjs'
import { bundleAsset } from './src/bundle-build.mjs'
import { platformAsset } from './src/platform.mjs'
export async function buildApp(root) {
  const run=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:root,stdio:'inherit'});if(r.error||r.status)throw r.error||new Error(`${cmd} failed`)}
  fs.rmSync(path.join(root,'dist'),{recursive:true,force:true}); run('vite',['build'])
  for(const name of ['main','worker','cli','mcp']) if(fs.existsSync(path.join(root,`src/backend/${name}.mjs`))) run('bun',['build',`src/backend/${name}.mjs`,'--target=node','--format=esm',`--outfile=dist/backend/${name}.mjs`])
  const cache = process.env.MOSS_BUILD_DEPENDENCY_CACHE || path.join(os.homedir(), '.cache/moss-apps-build')
  for (const name of ['engine', 'ffmpeg', 'ffprobe', 'pdf-engine']) {
    const file = path.join(root, 'resources', name + '.json')
    if (!fs.existsSync(file)) continue
    const spec = platformAsset(JSON.parse(fs.readFileSync(file, 'utf8')))
    const binary = await prepareBinary(spec, cache)
    const target = path.join(root, 'dist/engines', spec.id, spec.version, spec.executable)
    await bundleAsset(binary, target, spec.binarySha256)
    console.log(`Bundled ${spec.id} ${spec.version} (${spec.binarySha256})`)
  }
}
