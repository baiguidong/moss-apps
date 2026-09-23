import { describe, expect, it } from 'bun:test'
import * as appSdk from '../packages/app-sdk/src/index.mjs'
import { APP_HOST_API_VERSION, validateAppManifest } from '../packages/app-sdk/src/index.mjs'

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
  it('advertises Host API 2.1 while accepting Apps built for compatible 2.x hosts', () => {
    expect(APP_HOST_API_VERSION).toBe('2.1.0')
    expect(validateAppManifest(manifest()).hostApi).toBe('^2.0.0')
  })

  it('uses one Backend and accepts the legacy single declaration without retaining it', () => {
    expect(validateAppManifest(manifest()).backend).not.toHaveProperty('instanceMode')
    expect(validateAppManifest(manifest({ instanceMode: 'single' })).backend).not.toHaveProperty('instanceMode')
    expect(() => validateAppManifest(manifest({ instanceMode: 'multiple' }))).toThrow(/instanceMode/)
  })

  it('uses an implicit Desktop runtime and rejects target declarations', () => {
    expect(validateAppManifest(manifest()).backend).not.toHaveProperty('targets')
    expect(() => validateAppManifest(manifest({ targets: ['desktop'] }))).toThrow(/additional properties/)
    expect(() => validateAppManifest(manifest({ targets: ['server'] }))).toThrow(/additional properties/)
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
    expect(() => validateAppManifest(manifest({ serverOwnerScope: 'org' })))
      .toThrow(/additional properties/)
    expect(appSdk).not.toHaveProperty('MOSS_REMOTE_PROTOCOL')
    expect(appSdk.AppBackendClient.prototype).not.toHaveProperty('requestRemoteHost')
  })

  it('accepts only a flat protocol list', () => {
    const result = validateAppManifest(manifest({ protocols: ['moss.desktop/v1'] }))
    expect(result.backend?.protocols).toEqual(['moss.desktop/v1'])
    expect(() => validateAppManifest(manifest({ protocols: { desktop: ['moss.agent/v1'] } })))
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
