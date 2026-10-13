import path from 'node:path'
import type { NativeDesktopAdapterContext, NativeDesktopSession } from '@moss/app-sdk'
import { CuaDriverHost } from './driver-host.mjs'
import { ComputerUseService } from './service.mjs'
import { computerUseInputSchema, validateComputerUseOperation } from '../tool/schema'
import { normalizeResult } from '../tool/result.mjs'

export function createAdapter({ packageRoot, control, expectedBundleId }: NativeDesktopAdapterContext) {
  const host = new CuaDriverHost({ resourcesRoot: path.join(packageRoot, 'dist/native/resources/computer-use'), hostBundleId: expectedBundleId })
  const service = new ComputerUseService({ host, control, expectedBundleId })
  return Object.assign(service, {
    async invokeTool(action: string, input: unknown, session: NativeDesktopSession, signal?: AbortSignal) {
      if (action !== 'computer_use') throw new Error('Unknown native tool action')
      const { request } = computerUseInputSchema.parse(input)
      const invalid = validateComputerUseOperation(request)
      if (invalid) throw new Error(invalid)
      const started = Date.now()
      const result = await service.invoke(request, session, signal)
      result.structuredContent = { ...result.structuredContent, moss: { action: request.action, elapsed_ms: Date.now() - started } }
      return normalizeResult(result)
    },
    async requestPermissions() {
      if (process.platform !== 'darwin') return
      const { requestMacOSPermissions } = await import('@trycua/cua-driver/electron')
      await requestMacOSPermissions()
    },
    invalidate() { service.permissions = null; service.captureVerified = false; service.snapshots.clear() },
  })
}
