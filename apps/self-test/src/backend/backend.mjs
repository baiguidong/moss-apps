import { AppBackendClient } from '@moss/app-sdk'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createSelfTestService } from './service.mjs'

const protocol = 'moss.testing/v1'
export function createSelfTestBackend(options = {}) {
  const packageRoot = options.packageRoot || fileURLToPath(new URL('../../', import.meta.url))
  let service, dataDir, fixtures, closed = false, targetAlive = false
  const host = (method, input = {}, signal) => backend.host.request(protocol, method, input, { signal, timeoutMs: 300000 })
  const fileAction = (method, file) => backend.host.request('moss.local-files/v1', method, { path: file })
  async function settings() {
    const value = await host('environment')
    if (value.disabled) throw new Error('被测实例不能再次启动自测，请回到主 Moss。')
    return value
  }
  async function instanceStatus() {
    const env = await host('environment')
    if (env.disabled) return { phase: 'closed', prepared: false, disabled: true, message: '当前窗口是被测实例。' }
    const state = await host('target.status')
    return { ...state, phase: state.operation && state.operation !== 'close' ? 'starting' : state.phase,
      message: state.operationError || state.message }
  }
  const backend = new AppBackendClient({ ...options,
    onInitialize: async context => {
      dataDir = context.dataDir
      const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'app.moss.json'), 'utf8'))
      fixtures = JSON.parse(await fs.readFile(path.join(packageRoot, 'resources/fixtures.json'), 'utf8'))
      service = createSelfTestService({
        directory: path.join(dataDir, 'runs'), instanceHome: path.join(dataDir, 'target/home'),
        catalogDirectory: path.join(packageRoot, 'resources/self-tests'), appVersion: manifest.version, getSettings: settings,
        prepareBrowser: async () => {
          const versions = JSON.parse(await fs.readFile(path.join(packageRoot, 'dist/playwright-cdp/versions.json'), 'utf8'))
          return { version: versions['@playwright/mcp'], config: () => ({
            engineEntry: 'dist/playwright-cdp/node_modules/@playwright/mcp/cli.js',
            disabledTools: ['browser_navigate', 'browser_close', 'browser_install'],
          }) }
        },
        launchInstance: async ({ run, signal, onProgress }) => {
          const initial = await host('target.status', {}, signal)
          if (!['open', 'sync', 'reset'].includes(initial.operation)) await host('target.open', fixtures, signal)
          try {
            for (;;) {
              signal.throwIfAborted()
              const state = await host('target.status', {}, signal)
              await onProgress(state.progress || { stage: 'launch', label: state.message })
              if (!state.operation) {
                if (state.operationError) throw new Error(state.operationError)
                if (state.phase !== 'open') throw new Error('测试实例未打开。')
                break
              }
              await delay(250, undefined, { signal })
            }
          } catch (error) {
            // Cancel preparation, while a successfully opened target remains available.
            const state = await host('target.status').catch(() => null)
            if (state?.operation) await host('target.close').catch(() => {})
            throw error
          }
          const target = await host('target.attach', { runId: run.id }, signal)
          targetAlive = true
          Object.assign(run, target)
          return { endpoint: target.endpoint, exited: new Promise(() => {}), isAlive: () => targetAlive }
        },
        createController: async (run, config) => (await host('controller.create', {
          runId: run.id, title: `Moss 自测 · ${new Date(run.startedAt).toLocaleString()}`, ...config,
        })).sessionId,
        executeController: async (sessionId, prompt, signal) => {
          await host('controller.turn.start', { sessionId, prompt }, signal)
          for (;;) {
            signal.throwIfAborted()
            const turn = await host('controller.turn.status', { sessionId }, signal)
            if (turn.error === '测试实例提前退出。') targetAlive = false
            if (turn.state !== 'running') {
              if (turn.state !== 'completed') throw new Error(turn.error || '控制回合已停止。')
              return
            }
            await delay(250, undefined, { signal })
          }
        },
        interruptController: sessionId => host('controller.turn.abort', { sessionId }),
        stopController: sessionId => host('controller.dispose', { sessionId }),
        notify: state => backend.emit('self-test.changed', state),
        openReportWindow: file => closed ? Promise.resolve() : fileAction('preview', file),
      })
      await backend.host.subscribe(protocol, 'target.changed', value => {
        backend.emit('instance.changed', { ...value, phase: value.operation && value.operation !== 'close' ? 'starting' : value.phase })
      })
    },
    onShutdown: async () => { closed = true; service?.stop(); await service?.waitForIdle() },
  })
  backend.registerAction('catalog', () => service.getCatalog())
  backend.registerAction('status', async input => ({ ...await service.getStatus(input.runId), disabled: (await host('environment')).disabled }))
  backend.registerAction('run.start', input => service.start(input.caseIds))
  backend.registerAction('run.stop', input => service.stop(input.runId))
  backend.registerAction('report.open', input => service.openReport(input.runId))
  backend.registerAction('report.reveal', async input => fileAction('reveal', (await service.getStatus(input.runId)).reportPath))
  backend.registerAction('session.open', async input => {
    const run = await service.getStatus(input.runId)
    return host('controller.open', { sessionId: run.sessionId })
  })
  backend.registerAction('instance.status', instanceStatus)
  for (const operation of ['open', 'close', 'sync', 'reset']) backend.registerAction(`instance.${operation}`, async () => {
    if (service.isRunning() && operation !== 'open') throw new Error('请先停止自测，再管理测试实例。')
    const state = await host(`target.${operation}`, operation === 'close' ? {} : fixtures)
    return { ...state, phase: state.operation && state.operation !== 'close' ? 'starting' : state.phase }
  })
  backend.registerAction('self-test', async input => {
    const caller = ['start', 'record'].includes(input.action) ? await host('controller.caller') : { sessionId: null }
    return service.handle(input, caller.sessionId)
  })
  return backend
}
