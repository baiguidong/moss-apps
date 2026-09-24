import { describe, expect, it } from 'bun:test'
import * as appSdk from '@moss/app-sdk'
import { APP_HOST_API_VERSION, validateAppManifest } from '@moss/app-sdk'
import { validateRepositoryAppManifest } from './lib.mjs'

const backend = {
  entry: 'dist/backend/main.mjs',
  runtime: 'node',
  apiVersion: 1,
  lifecycle: 'persistent',
  actions: [],
}

function manifest(backendOverrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    id: 'example.app',
    version: '1.0.0',
    displayName: 'Example',
    hostApi: '^2.0.0',
    permissions: [],
    backend: { ...backend, ...backendOverrides },
  }
}

describe('App Backend manifest', () => {
  it('advertises Host API 2.2 while accepting Apps built for compatible 2.x hosts', () => {
    expect(APP_HOST_API_VERSION).toBe('2.2.0')
    for (const hostApi of ['^2.0.0', '^2.1.0', '^2.2.0']) {
      expect(validateAppManifest({ ...manifest(), hostApi }).hostApi).toBe(hostApi)
    }
    expect(() => validateAppManifest({ ...manifest(), hostApi: '^2.3.0' })).toThrow(/requires Host API/)
  })

  it('uses one Backend and accepts the legacy single declaration without retaining it', () => {
    expect(validateAppManifest(manifest()).backend).not.toHaveProperty('instanceMode')
    expect(validateAppManifest(manifest({ instanceMode: 'single' })).backend).not.toHaveProperty('instanceMode')
    expect(() => validateAppManifest(manifest({ instanceMode: 'multiple' }))).toThrow(/instanceMode/)
  })

  it('normalizes legacy fields like Core without changing the source manifest', () => {
    const source = manifest({ targets: ['desktop'], serverOwnerScope: 'org', futureField: true })
    const result = validateAppManifest(source)
    expect(result.backend).not.toHaveProperty('targets')
    expect(result.backend).not.toHaveProperty('serverOwnerScope')
    expect(result.backend).not.toHaveProperty('futureField')
    expect(source.backend).toMatchObject({ targets: ['desktop'], serverOwnerScope: 'org', futureField: true })
  })

  it('rejects target declarations in repository Apps before SDK normalization', () => {
    expect(validateRepositoryAppManifest(manifest()).backend).not.toHaveProperty('targets')
    for (const targets of [['desktop'], ['server']]) {
      expect(() => validateRepositoryAppManifest(manifest({ targets }))).toThrow(/backend.targets/)
    }
  })

  it('allows a Desktop UI and Backend in the same App', () => {
    const result = validateAppManifest({ ...manifest(), ui: { entry: 'dist/ui/index.html' } })
    expect(result.ui?.entry).toBe('dist/ui/index.html')
    expect(result.backend).not.toHaveProperty('targets')
  })

  it('discards legacy view placement while retaining routes and leaving source manifests intact', () => {
    for (const location of ['more', 'sidebar', 'hidden']) {
      const view = { id: 'home', title: 'Home', route: '#/home', location }
      const result = validateAppManifest({ ...manifest(), ui: { entry: 'dist/ui/index.html' }, contributes: { views: [view] } })
      expect(result.contributes?.views[0]).not.toHaveProperty('location')
      expect(result.contributes?.views[0].route).toBe('#/home')
      expect(view.location).toBe(location)
    }
  })

  it('rejects Server-only Backend properties and APIs', () => {
    expect(() => validateRepositoryAppManifest(manifest({ serverOwnerScope: 'org' })))
      .toThrow(/backend.serverOwnerScope/)
    expect(() => validateRepositoryAppManifest(manifest({ protocols: ['moss.remote/v1'] })))
      .toThrow(/moss.remote\/v1/)
    expect(appSdk).not.toHaveProperty('MOSS_REMOTE_PROTOCOL')
    expect(appSdk.AppBackendClient.prototype).not.toHaveProperty('requestRemoteHost')
  })

  it('accepts only a flat protocol list', () => {
    const result = validateAppManifest(manifest({ protocols: ['moss.platform/v1'] }))
    expect(result.backend?.protocols).toEqual(['moss.platform/v1'])
    expect(() => validateAppManifest(manifest({ protocols: { platform: ['moss.agent/v1'] } })))
      .toThrow(/backend\/protocols/)
  })

  it('does not inject placement or Remote APIs into Backend contexts', async () => {
    let context: Record<string, unknown> | undefined
    const client = new appSdk.AppBackendClient({
      send: () => {},
      onMessage: () => {},
      onDisconnect: () => {},
      onInitialize: (value: Record<string, unknown>) => { context = value },
    })
    expect(client).not.toHaveProperty('remote')
    await client.handleMessage(appSdk.createEnvelope('service.init', {
      appId: 'example.app',
      version: '1.0.0',
      instanceId: 'example.app--default',
      generation: 1,
      launchToken: 'launch-1',
      config: {},
      secrets: {},
      protocols: [],
      permissions: [],
      grants: [],
    }, { id: 'init-1' }))
    expect(context).not.toHaveProperty('target')
    expect(context).not.toHaveProperty('remote')
  })
})
