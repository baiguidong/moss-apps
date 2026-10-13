import { expect, test } from 'bun:test'
import { mergeReleaseVersions } from './release-variants.mjs'

const release = (platform: string, sha = platform) => ({ version: '0.2.0', hostApi: '^3.3.0', permissions: ['desktop:control'], platforms: [platform], artifacts: { [platform]: { sha256: sha, fileName: platform + '.zip' } } })
test('merges platform releases without losing either artifact and accepts duplicate identical records', () => {
  const mac = release('darwin-arm64'), windows = release('win32-x64')
  const merged = mergeReleaseVersions(mac, windows)
  expect(merged.platforms).toEqual(['darwin-arm64', 'win32-x64'])
  expect(merged.artifacts).toEqual({ ...mac.artifacts, ...windows.artifacts })
  expect(mergeReleaseVersions(merged, windows)).toEqual(merged)
})
test('rejects conflicting same-platform releases and incomplete variant maps', () => {
  expect(() => mergeReleaseVersions(release('win32-x64'), release('win32-x64', 'different'))).toThrow('Conflicting immutable')
  expect(() => mergeReleaseVersions(undefined, { ...release('win32-x64'), platforms: ['win32-x64', 'darwin-arm64'] })).toThrow('exactly match')
  expect(() => mergeReleaseVersions(release('win32-x64'), { ...release('darwin-arm64'), hostApi: '^4.0.0' })).toThrow('metadata')
})
