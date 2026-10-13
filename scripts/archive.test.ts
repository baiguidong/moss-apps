import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { unzipSync } from 'fflate'

test('release ZIP bytes are reproducible across runner time zones', () => {
  const moduleUrl = new URL('./archive.mjs', import.meta.url).href
  const source = `import { createDeterministicZip } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(createDeterministicZip({ 'app.moss.json': Buffer.from('fixture') }));`
  const archives = ['UTC', 'America/Los_Angeles', 'Asia/Shanghai'].map(TZ =>
    execFileSync('node', ['--input-type=module', '-e', source], { env: { ...process.env, TZ } }))
  expect(archives[1]).toEqual(archives[0])
  expect(archives[2]).toEqual(archives[0])
  expect(Buffer.from(unzipSync(archives[0])['app.moss.json']).toString()).toBe('fixture')
})
