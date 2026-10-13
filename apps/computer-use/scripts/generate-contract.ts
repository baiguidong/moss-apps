import fs from 'node:fs'
import { computerUseInputJSONSchema } from '../src/tool/schema'
import { computerUseDescription, computerUseInstructions } from '../src/tool/prompt'
fs.writeFileSync('schemas/computer-use.json', JSON.stringify(computerUseInputJSONSchema, null, 2) + '\n')
fs.writeFileSync('assets/instructions.md', computerUseInstructions + '\n')
// Refresh generated tool text without overwriting the App author's navigation,
// classification, Host requirement or other Manifest declarations.
const manifest = JSON.parse(fs.readFileSync('app.moss.json', 'utf8'))
manifest.version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
const tool = manifest.contributes?.tools?.find((item: { id: string }) => item.id === 'computer_use')
if (!tool) throw new Error('The Manifest must declare the computer_use tool')
tool.description = computerUseDescription
fs.writeFileSync('app.moss.json', JSON.stringify(manifest, null, 2) + '\n')
