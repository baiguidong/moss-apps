import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildBackend, appRoot } from './engine-build.mjs'
await buildBackend({ engine: 'src/engine/execute.mjs' }, path.join(appRoot, 'dist/backend'))
const { executeWorkflow } = await import('../dist/backend/engine.mjs')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-takt-spike-'))
try {
  const events = [], calls = []
  const result = await executeWorkflow({ yaml: 'name: hello\nmax_steps: 4\nsteps:\n  - name: hello\n    instruction: Say hello.\n    rules:\n      - condition: done\n        next: COMPLETE\n', task: 'Say hello', directory, onEvent: event => events.push(event), callHost: async input => {
    calls.push({ step: input.step, phase: input.phase, schema: input.outputSchema })
    const value = input.outputSchema.properties?.matched_index ? { matched_index: 1 } : input.outputSchema.properties?.rule_index ? { rule_index: 1 } : { content: 'Hello\n[HELLO:1]' }
    return { value, tokens: 1 }
  } })
  console.log(JSON.stringify({ result, calls, events }, null, 2))
  if (result.status !== 'completed') process.exitCode = 1
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
