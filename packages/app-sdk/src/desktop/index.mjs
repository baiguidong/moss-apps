import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'

export const MOSS_DESKTOP_PROTOCOL = 'moss.desktop/v1'
export const MAX_INLINE_FILE_BASE64_LENGTH = 512 * 1024

export const DESKTOP_PERMISSIONS = Object.freeze({
  files: 'desktop:files',
  screenCapture: 'desktop:screen-capture',
  externalLinks: 'desktop:external-links',
  media: 'desktop:media',
})

export const DESKTOP_HOST_METHOD_PERMISSIONS = Object.freeze({
  'file.pick': DESKTOP_PERMISSIONS.files,
  'file.materialize': DESKTOP_PERMISSIONS.files,
  'file.thumbnail': DESKTOP_PERMISSIONS.files,
  'file.download': DESKTOP_PERMISSIONS.files,
  'screen.capture': DESKTOP_PERMISSIONS.screenCapture,
  'shell.open-external': DESKTOP_PERMISSIONS.externalLinks,
})

export const DESKTOP_HOST_METHODS = Object.freeze(Object.keys(DESKTOP_HOST_METHOD_PERMISSIONS))

function fail(message) {
  throw new AppServiceError(APP_ERROR_CODES.invalidInput, message)
}

function record(value, label) {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value
}

function text(input, field, label, { optional = false, maxLength = 4096 } = {}) {
  const value = input[field]
  if (optional && (value === undefined || value === null || value === '')) return ''
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) fail(`${label} has an invalid ${field}`)
  return value.trim()
}

function rejectUnknown(input, allowedFields, label) {
  const allowed = new Set(allowedFields)
  for (const field of Object.keys(input)) if (!allowed.has(field)) fail(`${label} contains an unknown field: ${field}`)
}

export function validateDesktopHostMethod(value) {
  const method = typeof value === 'string' ? value.trim() : ''
  if (!Object.hasOwn(DESKTOP_HOST_METHOD_PERMISSIONS, method)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `Unknown ${MOSS_DESKTOP_PROTOCOL} Host method: ${method || '<empty>'}`)
  }
  return method
}

export function validateDesktopHostInput(method, value) {
  const normalizedMethod = validateDesktopHostMethod(method)
  const input = record(value, `${normalizedMethod} input`)
  for (const field of ['appId', 'instanceId', 'owner', 'principal']) {
    if (Object.hasOwn(input, field)) fail(`${normalizedMethod} cannot override Runtime identity: ${field}`)
  }
  if (normalizedMethod === 'file.pick') {
    rejectUnknown(input, ['kind', 'multiple'], normalizedMethod)
    if (input.kind !== undefined && !['image', 'video', 'audio', 'file'].includes(input.kind)) fail('file.pick has an invalid kind')
    if (input.multiple !== undefined && typeof input.multiple !== 'boolean') fail('file.pick multiple must be a boolean')
  } else if (normalizedMethod === 'file.materialize') {
    rejectUnknown(input, ['fileName', 'dataBase64', 'transferId', 'offset', 'complete'], normalizedMethod)
    text(input, 'fileName', normalizedMethod, { maxLength: 300 })
    text(input, 'dataBase64', normalizedMethod, { maxLength: MAX_INLINE_FILE_BASE64_LENGTH })
    if (input.transferId !== undefined
      && (typeof input.transferId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.transferId))) {
      fail('file.materialize has an invalid transferId')
    }
    if (input.offset !== undefined
      && (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > 100 * 1024 * 1024)) {
      fail('file.materialize has an invalid offset')
    }
    if (input.complete !== undefined && typeof input.complete !== 'boolean') {
      fail('file.materialize has an invalid complete flag')
    }
  } else if (normalizedMethod === 'file.thumbnail') {
    rejectUnknown(input, ['path', 'width', 'height'], normalizedMethod)
    text(input, 'path', normalizedMethod)
    for (const field of ['width', 'height']) {
      if (input[field] !== undefined && (!Number.isInteger(input[field]) || input[field] < 1 || input[field] > 4096)) {
        fail(`file.thumbnail ${field} must be between 1 and 4096`)
      }
    }
  } else if (normalizedMethod === 'file.download') {
    rejectUnknown(input, ['url', 'fileName'], normalizedMethod)
    const url = text(input, 'url', normalizedMethod)
    if (!/^https?:\/\//i.test(url)) fail('file.download requires an HTTP or HTTPS URL')
    text(input, 'fileName', normalizedMethod, { maxLength: 300 })
  } else if (normalizedMethod === 'screen.capture') {
    rejectUnknown(input, [], normalizedMethod)
  } else if (normalizedMethod === 'shell.open-external') {
    rejectUnknown(input, ['url'], normalizedMethod)
    const url = text(input, 'url', normalizedMethod)
    if (!/^https?:\/\//i.test(url)) fail('shell.open-external requires an HTTP or HTTPS URL')
  }
  return input
}

function outputRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} must be an object`)
  }
  return value
}

function outputText(value, label, maxLength = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} is invalid`)
  }
}

function rejectUnknownOutputFields(output, fields, label) {
  const allowed = new Set(fields)
  for (const field of Object.keys(output)) {
    if (!allowed.has(field)) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label} contains an unknown field: ${field}`)
    }
  }
}

function validateDesktopFile(value, label) {
  const file = outputRecord(value, label)
  rejectUnknownOutputFields(file, ['name', 'path', 'size', 'mediaUrl'], label)
  outputText(file.name, `${label}.name`, 300)
  outputText(file.path, `${label}.path`)
  outputText(file.mediaUrl, `${label}.mediaUrl`, 16_384)
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > 100 * 1024 * 1024) {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `${label}.size is invalid`)
  }
}

export function validateDesktopHostOutput(method, value) {
  const normalizedMethod = validateDesktopHostMethod(method)
  const output = outputRecord(value, `${normalizedMethod} output`)
  if (normalizedMethod === 'file.pick') {
    rejectUnknownOutputFields(output, ['files'], 'file.pick output')
    if (!Array.isArray(output.files) || output.files.length > 10_000) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'file.pick output files is invalid')
    }
    output.files.forEach((file, index) => validateDesktopFile(file, `file.pick output files[${index}]`))
  } else if (normalizedMethod === 'file.materialize') {
    if (output.complete === false) {
      rejectUnknownOutputFields(output, ['transferId', 'complete', 'size'], 'file.materialize output')
      outputText(output.transferId, 'file.materialize output transferId', 128)
      if (!Number.isSafeInteger(output.size) || output.size < 0 || output.size > 100 * 1024 * 1024) {
        throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'file.materialize output size is invalid')
      }
    } else {
      validateDesktopFile(output, 'file.materialize output')
    }
  } else if (normalizedMethod === 'file.thumbnail') {
    rejectUnknownOutputFields(output, ['path', 'mediaUrl'], 'file.thumbnail output')
    outputText(output.path, 'file.thumbnail output path')
    outputText(output.mediaUrl, 'file.thumbnail output mediaUrl', 16_384)
  } else if (normalizedMethod === 'file.download') {
    rejectUnknownOutputFields(output, ['canceled', 'filePath'], 'file.download output')
    if (typeof output.canceled !== 'boolean') {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'file.download output canceled is invalid')
    }
    if (!output.canceled) outputText(output.filePath, 'file.download output filePath')
  } else if (normalizedMethod === 'screen.capture') {
    validateDesktopFile(output, 'screen.capture output')
  } else {
    rejectUnknownOutputFields(output, ['opened'], 'shell.open-external output')
    if (output.opened !== true) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'shell.open-external output opened is invalid')
    }
  }
  return output
}
