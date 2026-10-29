import fs from 'node:fs/promises'
if (process.argv.slice(2).some(arg => !['--help', 'guidance'].includes(arg))) throw new Error('Use builder_* tools in the main conversation for project operations')
console.log(await fs.readFile(new URL('./README.md', import.meta.url), 'utf8'))
