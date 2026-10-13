import { directories, absolutePath } from './paths'
import { findGit, repository, runGit } from './git'
import { validateSettings, type Settings } from '../contracts'
export async function resolveSettings(raw: Settings): Promise<Settings> {
  const settings = validateSettings(raw)
  const roots = await directories(settings.directories)
  if (!roots.length) return { ...settings, directories: [], gitExecutable: settings.gitExecutable ? absolutePath(settings.gitExecutable) : '' }
  const executable = await findGit(settings.gitExecutable)
  const version = await runGit(executable, undefined, ['--version'])
  if (!version.startsWith('git version ')) throw new Error('指定的程序不是 Git。')
  for (const root of roots) await repository(executable, root)
  return { ...settings, directories: roots, gitExecutable: executable }
}
