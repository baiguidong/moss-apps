import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { npmInvocation } from './npm-command.mjs'

test.each(['darwin', 'linux'])('npm uses direct argv without a shell on %s', platform => {
  expect(npmInvocation({ platform })).toEqual({ command: 'npm', args: [] })
})

test('Windows npm invokes its JS CLI with Node and preserves spaces and Unicode paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-npm-'))
  try {
    const directory = path.join(root, 'Node 工具 with spaces')
    const cli = path.join(directory, 'node_modules/npm/bin/npm-cli.js')
    await fs.mkdir(path.dirname(cli), { recursive: true })
    await fs.writeFile(cli, '')
    const executable = path.join(directory, 'node.exe')
    expect(npmInvocation({ platform: 'win32', executable, env: {} })).toEqual({ command: executable, args: [cli] })
    const other = path.join(root, 'elsewhere', 'node.exe')
    expect(npmInvocation({ platform: 'win32', executable: other, env: { Path: directory } })).toEqual({ command: other, args: [cli] })
    expect(() => npmInvocation({ platform: 'win32', executable: other, env: {} })).toThrow('Cannot locate npm-cli.js')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
