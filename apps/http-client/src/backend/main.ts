import { defineAppBackend, AppServiceError, APP_ERROR_CODES } from '@moss/app-sdk'
import { sendRequest, RequestError } from '../core/request'
let active = 0
defineAppBackend({
  'request.send': async (input, context) => {
    if (active >= 4) throw new AppServiceError('HTTP_BUSY', '同时最多发送 4 个请求，请稍后重试。')
    active++
    try { return await sendRequest(input, context.signal) }
    catch (error) {
      if (error instanceof RequestError) throw new AppServiceError(error.code === 'INVALID_INPUT' ? APP_ERROR_CODES.invalidInput : `HTTP_${error.code}`, error.message)
      throw new AppServiceError('HTTP_FAILED', '请求失败，请重试。')
    } finally { active-- }
  },
})
