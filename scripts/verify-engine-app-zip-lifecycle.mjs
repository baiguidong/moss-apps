import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TaskStore } from '../packages/engine-apps/src/runtime.mjs'

// Run one archive at a time so the installed engines fit on machines with little free space.
const appNames = new Set(['backup', 'data-workbench', 'document-converter'])
const appName = process.argv[2]
if (!appNames.has(appName) || process.argv.length !== 3) {
  console.error('Usage: node scripts/verify-engine-app-zip-lifecycle.mjs <backup|data-workbench|document-converter>')
  process.exit(2)
}

const repo = fileURLToPath(new URL('..', import.meta.url))
const core = path.resolve(repo, '../moss')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const idleTimeoutMs = 200
const terminalStatuses = new Set(['succeeded', 'failed', 'partial', 'canceled', 'interrupted'])

async function waitFor(check, description, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs
  let lastError
  while (Date.now() < end) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) { lastError = error }
    await sleep(40)
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`)
}

async function waitTask(store, id) {
  const task = await waitFor(async () => {
    const current = await store.read(id)
    return terminalStatuses.has(current.status) ? current : null
  }, `task ${id}`, 180_000)
  assert.equal(task.status, 'succeeded', `${task.status}: ${task.message || ''}`)
  return task
}

async function waitStopped(host, appId, instanceId) {
  return waitFor(async () => {
    const status = await host.getInstanceStatus(appId, instanceId)
    return status?.state === 'stopped' && status.pid === null && status.activeWork === 0 ? status : null
  }, `${appId} Backend idle exit`, 30_000)
}

async function makeBackupInputs(root, host, appId, instanceId, store) {
  const repository = path.join(root, 'repository')
  const source = path.join(root, 'source')
  await Promise.all([repository, source].map(dir => fs.mkdir(dir, { recursive: true })))
  await host.updateInstance(appId, instanceId, { secrets: { password: 'moss-isolated-zip-smoke-password' } })
  assert.equal((await host.getInstanceStatus(appId, instanceId)).pid, null)
  const initialized = await host.invoke(appId, instanceId, 'tasks.start', { command: 'init', repo: repository }, { timeoutMs: 300_000 })
  await waitTask(store, initialized.id)
  await waitStopped(host, appId, instanceId)

  // Many small files keep the real Restic worker active beyond the short test idle period.
  for (let start = 0; start < 8_000; start += 100) {
    await Promise.all(Array.from({ length: 100 }, (_, offset) => {
      const index = start + offset
      return fs.writeFile(path.join(source, `file-${String(index).padStart(5, '0')}.txt`), `Moss ZIP smoke ${index}\n`)
    }))
  }
  const input = { command: 'backup', repo: repository, paths: [source] }
  return { input, recoveryInput: input, expectedKind: 'json', expectedText: 'summary' }
}

async function makeDataWorkbenchInputs() {
  const input = { mode: 'query', sql: 'SELECT sum(sin(i::DOUBLE)) AS total FROM range(120000000) t(i)' }
  return { input, recoveryInput: input, expectedKind: 'json', expectedText: 'total' }
}

async function makeDocumentConverterInputs(root) {
  const inputFile = path.join(root, 'source.md')
  const filter = path.join(root, 'delay.lua')
  await fs.writeFile(inputFile, '# Moss ZIP smoke\n\nA complete local App lifecycle.\n')
  await fs.writeFile(filter, 'function Para(el)\n  local deadline = os.clock() + 1.2\n  while os.clock() < deadline do end\n  return el\nend\n')
  const input = { mode: 'merge', paths: [inputFile], to: 'html5', options: { 'lua-filter': filter } }
  return { input, recoveryInput: input, pdfInput: { mode: 'merge', paths: [inputFile], to: 'pdf' },
    expectedKind: 'document', expectedText: 'Moss ZIP smoke' }
}

async function readHistoricalArtifact(host, appId, instanceId, task, expectedKind, expectedText) {
  await waitStopped(host, appId, instanceId)
  const history = await host.invoke(appId, instanceId, 'tasks.get', { id: task.id }, { timeoutMs: 300_000 })
  assert.equal(history.status, 'succeeded')
  const artifact = history.artifacts?.find(file => file.kind === expectedKind)
  assert.ok(artifact, `No ${expectedKind} artifact in historical task ${task.id}`)
  assert.match(artifact.url || '', /^http:\/\/127\.0\.0\.1:\d+\//)
  await waitStopped(host, appId, instanceId)
  const response = await fetch(artifact.url, { signal: AbortSignal.timeout(10_000) })
  assert.equal(response.status, 200, `Signed artifact HTTP ${response.status}`)
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'self' moss-app:/)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.ok(bytes.length > 0, 'Signed artifact is empty')
  if (expectedKind === 'pdf') assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
  else assert.ok(bytes.toString('utf8').includes(expectedText), `Artifact does not contain ${expectedText}`)
  return { name: artifact.name, bytes: bytes.length, status: response.status }
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'apps', appName, 'app.moss.json'), 'utf8'))
  const appId = `moss.${appName}`
  assert.equal(manifest.id, appId)
  assert.equal(manifest.backend?.lifecycle, 'on-demand')
  const archive = path.join(repo, 'artifacts', appId, manifest.version,
    `${appId}-${manifest.version}-darwin-arm64.zip`)
  assert.ok((await fs.stat(archive)).isFile(), `Target archive is missing: ${archive}`)

  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `moss-${appName}-zip-lifecycle-`)))
  const root = path.join(temp, 'host')
  process.env.MOSS_HOME = root
  process.env.MOSS_CONFIG_DIR = root
  let host, artifactUrls
  try {
    const [runtimeModule, installationModule, artifactModule, localFilesModule] = await Promise.all([
      import(pathToFileURL(path.join(core, 'packages/app-runtime/src/host/index.mjs')).href),
      import(pathToFileURL(path.join(core, 'ui/src/apps/app-runtime.mjs')).href),
      import(pathToFileURL(path.join(core, 'ui/src/apps/app-artifacts.mjs')).href),
      import(pathToFileURL(path.join(core, 'ui/src/apps/app-local-host.mjs')).href),
    ])
    const { AppRuntimeHost } = runtimeModule
    const { installAppArchive, AppCredentialAdapter } = installationModule
    const { createAppArtifactProtocolDefinition, createAppArtifactUrls } = artifactModule
    const { createLocalFilesProtocolDefinition } = localFilesModule
    const events = []
    const createHost = () => {
      const urls = createAppArtifactUrls()
      const runtime = new AppRuntimeHost({
        rootDir: root,
        nodeExecutable: process.execPath,
        requireTrustedPublisher: false,
        credentialAdapter: new AppCredentialAdapter(root),
        processOptions: { idleTimeoutMs, handshakeTimeoutMs: 10_000, shutdownTimeoutMs: 3_000,
          killTimeoutMs: 1_000, restartBaseDelayMs: 100, maxRestartDelayMs: 1_000 },
        hostCapabilityOptions: { protocols: [createLocalFilesProtocolDefinition(), createAppArtifactProtocolDefinition()] },
      })
      runtime.registerHostHandler('moss.artifacts/v1', 'url.get', (input, context) => urls.url(input, context))
      runtime.events.on('event', event => { if (event.appId === appId && event.type === 'status') events.push(event) })
      return { runtime, urls }
    }
    ;({ runtime: host, urls: artifactUrls } = createHost())
    await host.initialize()
    await installAppArchive(host, archive)
    const installed = await host.getActivePackage(appId)
    assert.equal(installed.manifest.id, appId)
    assert.equal(installed.manifest.version, manifest.version)
    assert.equal(installed.manifest.hostApi, manifest.hostApi, 'ZIP Host API requirement is stale')
    assert.equal(installed.manifest.backend?.lifecycle, 'on-demand')
    const instance = await host.ensureDefaultInstance(appId)
    const instanceId = instance.id
    const store = new TaskStore(host.appDataPath(host.dataDir, appId, 'instances', instanceId))
    await waitStopped(host, appId, instanceId)

    const plan = appName === 'backup'
      ? await makeBackupInputs(temp, host, appId, instanceId, store)
      : appName === 'data-workbench'
        ? await makeDataWorkbenchInputs()
        : await makeDocumentConverterInputs(temp)
    const created = await host.invoke(appId, instanceId, 'tasks.start', plan.input, { timeoutMs: 300_000 })
    assert.match(created.id, /^[a-f0-9-]{36}$/)
    const active = await waitFor(async () => {
      const status = await host.getInstanceStatus(appId, instanceId)
      return status?.pid && status.activeWork > 0 ? status : null
    }, `${appId} active task lease`, 15_000)
    await sleep(idleTimeoutMs * 2 + 100)
    const retained = await host.getInstanceStatus(appId, instanceId)
    assert.equal(retained.pid, active.pid, 'Backend stopped while a real task was active')
    assert.ok(retained.activeWork > 0, 'Active task lease disappeared before work completed')
    const finished = await waitTask(store, created.id)
    assert.ok(finished.artifacts?.length > 0)
    const artifact = await readHistoricalArtifact(host, appId, instanceId, finished,
      plan.expectedKind, plan.expectedText)

    let pdfArtifact
    if (plan.pdfInput) {
      const pdf = await host.invoke(appId, instanceId, 'tasks.start', plan.pdfInput, { timeoutMs: 300_000 })
      await waitTask(store, pdf.id)
      pdfArtifact = await readHistoricalArtifact(host, appId, instanceId, pdf, 'pdf', '')
    }

    await host.shutdown()
    await artifactUrls.close()
    host = artifactUrls = null
    const pending = await store.createQueued(plan.recoveryInput)
    events.length = 0
    ;({ runtime: host, urls: artifactUrls } = createHost())
    await host.initialize()
    assert.ok(events.some(event => event.pid && event.state === 'running'),
      'Host restart did not start the Backend for an on-disk pending task')
    const recovered = await waitTask(store, pending.id)
    await waitStopped(host, appId, instanceId)
    const recoveredArtifact = await readHistoricalArtifact(host, appId, instanceId, recovered,
      plan.expectedKind, plan.expectedText)

    console.log(JSON.stringify({ appId, version: manifest.version, archive,
      checks: { installedIdle: true, actionWokeBackend: true, activeWorkSurvivedIdle: true,
        finishedIdle: true, historicalArtifact: artifact, pdfArtifact,
        pendingWorkWokeAfterRestart: true, recoveredArtifact } }, null, 2))
  } finally {
    await host?.shutdown().catch(error => console.error('Host cleanup:', error))
    await artifactUrls?.close().catch(error => console.error('Artifact cleanup:', error))
    await fs.rm(temp, { recursive: true, force: true })
  }
}

await main()
