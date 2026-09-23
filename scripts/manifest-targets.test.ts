import { describe, expect, it } from 'bun:test'
import { APP_HOST_API_VERSION, resolveBackendProtocols, validateAppManifest } from '../packages/app-sdk/src/index.mjs'

const backend = {
  entry: 'dist/backend/main.mjs',
  runtime: 'node',
  apiVersion: 1,
  lifecycle: 'persistent',
  instanceMode: 'single',
  actions: [],
}

function manifest(targets: Array<'desktop' | 'server'>, backendOverrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    id: 'example.app',
    version: '1.0.0',
    displayName: 'Example',
    hostApi: '^2.0.0',
    permissions: [],
    backend: { ...backend, targets, ...backendOverrides },
  }
}

describe('Backend target declarations', () => {
  it('advertises Host API 2.1 while accepting Apps built for compatible 2.x hosts', () => {
    expect(APP_HOST_API_VERSION).toBe('2.1.0')
    expect(validateAppManifest(manifest(['desktop'])).hostApi).toBe('^2.0.0')
    expect(() => validateAppManifest(manifest(['desktop'], {
      protocols: { desktop: ['moss.desktop/v1'] },
    }))).toThrow(/Host API >=2.1.0/)
    expect(validateAppManifest({
      ...manifest(['desktop'], { protocols: { desktop: ['moss.desktop/v1'] } }),
      hostApi: '^2.1.0',
    }).hostApi).toBe('^2.1.0')
  })

  it('accepts each explicit supported placement set', () => {
    expect(validateAppManifest(manifest(['desktop'])).backend?.targets).toEqual(['desktop'])
    expect(validateAppManifest(manifest(['server'])).backend?.targets).toEqual(['server'])
    expect(validateAppManifest(manifest(['desktop', 'server'])).backend?.targets).toEqual(['desktop', 'server'])
  })

  it('keeps UI presence independent from Backend placement', () => {
    expect(validateAppManifest({
      ...manifest(['server']),
      ui: { entry: 'dist/ui/index.html' },
    }).backend?.targets).toEqual(['server'])
  })

  it('allows Server owner scope only for a Server-capable Backend', () => {
    expect(() => validateAppManifest(manifest(['desktop'], { serverOwnerScope: 'org' })))
      .toThrow(/serverOwnerScope requires server/)
    expect(validateAppManifest(manifest(['server'], { serverOwnerScope: 'org' })).backend?.serverOwnerScope)
      .toBe('org')
  })

  it('declares and resolves protocols independently for each target', () => {
    const result = validateAppManifest({
      ...manifest(['desktop', 'server'], {
        protocols: {
          desktop: ['moss.desktop/v1'],
          server: ['moss.agent/v1'],
        },
      }),
      hostApi: '^2.1.0',
    })
    expect(resolveBackendProtocols(result.backend, 'desktop')).toEqual(['moss.desktop/v1'])
    expect(resolveBackendProtocols(result.backend, 'server')).toEqual(['moss.agent/v1'])
    expect(resolveBackendProtocols({ ...backend, targets: ['desktop', 'server'], protocols: ['moss.agent/v1'] }, 'server'))
      .toEqual(['moss.agent/v1'])
    expect(() => validateAppManifest({
      ...manifest(['desktop'], { protocols: { server: ['moss.agent/v1'] } }),
      hostApi: '^2.1.0',
    })).toThrow(/protocols.server requires server/)
  })
})
