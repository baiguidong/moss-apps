import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'

export const MOSS_DESKTOP_PROTOCOL = 'moss.desktop/v1'

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
    rejectUnknown(input, ['fileName', 'dataBase64'], normalizedMethod)
    text(input, 'fileName', normalizedMethod, { maxLength: 300 })
    text(input, 'dataBase64', normalizedMethod, { maxLength: 140_000_000 })
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
