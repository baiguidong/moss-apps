import { defineAppBackend, AppServiceError, APP_ERROR_CODES } from '@moss/app-sdk'
import { execute } from '../core'
import type { Action, Inputs } from '../contracts'
const handler = <K extends Action>(action: K) => async (input: unknown) => {
  try { return await execute(action, input as Inputs[K]) }
  catch (error) { throw new AppServiceError(APP_ERROR_CODES.invalidInput, error instanceof Error ? error.message : '转换失败，请检查输入。') }
}
defineAppBackend({
  'timestamp.convert': handler('timestamp.convert'),
  'base64.convert': handler('base64.convert'),
  'json.process': handler('json.process'),
  'aes.process': handler('aes.process'),
})
