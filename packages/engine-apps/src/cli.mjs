import fs from 'node:fs/promises'
import path from 'node:path'
import { TaskStore, executeTask } from './runtime.mjs'

export async function cli(engine) {
  try {
    const args = process.argv.slice(2), position = args.indexOf('--data-dir')
    if (position < 0 || !path.isAbsolute(args[position+1] || '')) throw new Error('Use --data-dir with the App dataDir supplied in the App skill context')
    const dataDir=args[position+1]; args.splice(position,2)
    const store=new TaskStore(dataDir), command=args.shift() || 'help'
    let result
    if (command === 'help') result={commands:['describe','run --input-file <absolute JSON path>','list','show <task-id>','cancel <task-id>'], engine:engine.id, dataDir}
    else if (command === 'describe') result=await engine.catalog({dataDir,prepare:true})
    else if (command === 'list') result=await store.list()
    else if (command === 'show') { result=await store.get(args[0]); result.log=await fs.readFile(path.join(store.directory(args[0]),'stderr.log'),'utf8').catch(()=>'') }
    else if (command === 'cancel') result=await store.cancel(args[0])
    else if (command === 'run') {
      if (args[0]!=='--input-file' || !path.isAbsolute(args[1] || '')) throw new Error('Use run --input-file /absolute/request.json; do not concatenate shell arguments')
      const input=JSON.parse(await fs.readFile(args[1],'utf8')); await engine.validate(input)
      result=await executeTask(engine,store,await store.create(input,'agent-skill'))
      if(result.status!=='succeeded') process.exitCode=1
    } else throw new Error('Unknown command. Use help.')
    process.stdout.write(JSON.stringify(result,null,2)+'\n')
  } catch(error) { process.stdout.write(JSON.stringify({error:error.message})+'\n'); process.exitCode=1 }
  finally { await engine.close?.() }
}
