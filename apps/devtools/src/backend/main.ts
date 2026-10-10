import { defineAppBackend, AppServiceError, APP_ERROR_CODES } from '@moss/app-sdk'
import { execute } from '../core'
import { sendRequest, RequestError } from '../http/core/request'
import type { Action, Inputs } from '../contracts'
let activeRequests = 0
const handler = <K extends Action>(action: K) => async (input: unknown) => {
  try { return await execute(action, input as Inputs[K]) }
  catch (error) { throw new AppServiceError(APP_ERROR_CODES.invalidInput, error instanceof Error ? error.message : '转换失败，请检查输入。') }
}
defineAppBackend({
  'timestamp.convert': handler('timestamp.convert'),
  'base64.convert': handler('base64.convert'),
  'json.process': handler('json.process'),
  'aes.process': handler('aes.process'),
  'request.send': async (input, context) => {
    if (activeRequests >= 4) throw new AppServiceError('HTTP_BUSY', '同时最多发送 4 个请求，请稍后重试。')
    activeRequests++
    try { return await sendRequest(input, context.signal) }
    catch (error) {
      if (error instanceof RequestError) throw new AppServiceError(error.code === 'INVALID_INPUT' ? APP_ERROR_CODES.invalidInput : `HTTP_${error.code}`, error.message)
      throw new AppServiceError('HTTP_FAILED', '请求失败，请重试。')
    } finally { activeRequests-- }
  },
})
