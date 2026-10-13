import { spawnSync } from 'node:child_process';
// Compare generated declarations without changing the source snapshot.
const result = spawnSync('bun', ['-e', `
  import fs from 'node:fs';
  import { computerUseInputJSONSchema } from './src/tool/schema.ts';
  import { computerUseInstructions, computerUseDescription } from './src/tool/prompt.ts';
  if (JSON.stringify(JSON.parse(fs.readFileSync('schemas/computer-use.json'))) !== JSON.stringify(computerUseInputJSONSchema)) throw new Error('Regenerate schema');
  if (fs.readFileSync('assets/instructions.md','utf8').trim() !== computerUseInstructions.trim()) throw new Error('Regenerate instructions');
  if (JSON.parse(fs.readFileSync('app.moss.json')).contributes.tools[0].description !== computerUseDescription) throw new Error('Regenerate description');
`], { stdio: 'inherit' });
process.exit(result.status ?? 1);
