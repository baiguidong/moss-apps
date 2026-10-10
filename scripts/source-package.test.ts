import { test, expect } from 'bun:test'
import { focusedLock, parseLock } from './source-package.mjs'

test('focused lock retains exact nested resolutions and excludes unrelated Apps', () => {
  const lock = { lockfileVersion: 1, configVersion: 1, packages: {
    dep: ['dep@2.0.0', '', {}, 'integrity-root'],
    '@moss/example/dep': ['dep@1.0.0', '', { dependencies: { child: '1.0.0' } }, 'integrity-pinned'],
    child: ['child@1.0.0', '', {}, 'integrity-child'],
    unrelated: ['unrelated@9.0.0', '', {}, 'unused'],
    '@moss/other': ['@moss/other@workspace:apps/other'],
  } }
  const result = focusedLock(lock, { '': { name: 'root' }, 'apps/example': { name: '@moss/example', dependencies: { dep: '1.0.0' } } })
  expect(result.packages['@moss/example/dep']).toEqual(lock.packages['@moss/example/dep'])
  expect(result.packages.child).toEqual(lock.packages.child)
  expect(result.packages.unrelated).toBeUndefined()
  expect(result.packages['@moss/other']).toBeUndefined()
  expect(result.packages.dep).toBeUndefined()
})

test('missing locked dependency fails instead of resolving latest', () => {
  expect(() => focusedLock({ packages: {} }, { '': { name: 'root', dependencies: { missing: '^1' } } })).toThrow('Lockfile dependency missing')
  expect(parseLock('{"lockfileVersion":1,"packages":{},}')).toEqual({ lockfileVersion: 1, packages: {} })
})
