import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
export async function seedRepository(directory) {
  await mkdir(directory, { recursive: true })
  const git = (args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Moss Test']); git(['config', 'user.email', 'test@example.invalid'])
  git(['config', 'commit.gpgSign', 'false'])
  await writeFile(join(directory, 'note.txt'), 'initial\n')
  git(['add', 'note.txt']); git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Initial fixture'])
  return { path: await realpath(directory), git }
}
