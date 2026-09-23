import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'

export const MOSS_OPENIM_PROTOCOL = 'moss.openim/v1'

export const OPENIM_PERMISSIONS = Object.freeze({
  client: 'openim:client',
})

export const OPENIM_HOST_METHOD_PERMISSIONS = Object.freeze({
  'session.issue': OPENIM_PERMISSIONS.client,
  'directory.list': OPENIM_PERMISSIONS.client,
  'conversation.direct.prepare': OPENIM_PERMISSIONS.client,
  'conversation.group.prepare': OPENIM_PERMISSIONS.client,
})

export const OPENIM_HOST_METHODS = Object.freeze(Object.keys(OPENIM_HOST_METHOD_PERMISSIONS))

function fail(message, code = APP_ERROR_CODES.invalidInput) {
  throw new AppServiceError(code, message)
}

function record(value, label, code = APP_ERROR_CODES.invalidInput) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`, code)
  return value
}

function rejectUnknownFields(value, allowed, label, code = APP_ERROR_CODES.invalidInput) {
  const fields = new Set(allowed)
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) fail(`${label} contains an unknown field: ${field}`, code)
  }
}

function requiredString(value, label, code = APP_ERROR_CODES.invalidInput) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) fail(`${label} is invalid`, code)
  return value.trim()
}

function optionalNullableString(value, label) {
  if (value === undefined || value === null) return
  if (typeof value !== 'string' || value.length > 512) fail(`${label} is invalid`, APP_ERROR_CODES.hostProtocol)
}

export function validateOpenIMHostMethod(value) {
  const method = typeof value === 'string' ? value.trim() : ''
  if (!Object.hasOwn(OPENIM_HOST_METHOD_PERMISSIONS, method)) {
    fail(`Unknown ${MOSS_OPENIM_PROTOCOL} Host method: ${method || '<empty>'}`, APP_ERROR_CODES.hostProtocol)
  }
  return method
}

export function validateOpenIMHostInput(method, value) {
  const normalizedMethod = validateOpenIMHostMethod(method)
  const input = value === undefined ? {} : record(value, `${normalizedMethod} input`)
  for (const field of ['appId', 'instanceId', 'owner', 'principal', 'orgId']) {
    if (Object.hasOwn(input, field)) fail(`${normalizedMethod} cannot override Runtime identity: ${field}`)
  }
  if (normalizedMethod === 'session.issue') {
    rejectUnknownFields(input, ['platformId'], normalizedMethod)
    if (!Number.isInteger(input.platformId) || input.platformId < 1 || input.platformId > 8) {
      fail('session.issue has an invalid platformId')
    }
    return { platformId: input.platformId }
  }
  if (normalizedMethod === 'directory.list') {
    rejectUnknownFields(input, ['cursor', 'limit'], normalizedMethod)
    const cursor = input.cursor === undefined
      ? undefined
      : requiredString(input.cursor, 'directory.list cursor')
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)) {
      fail('directory.list limit must be between 1 and 200')
    }
    return {
      ...(cursor ? { cursor } : {}),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }
  }
  if (normalizedMethod === 'conversation.direct.prepare') {
    rejectUnknownFields(input, ['userId'], normalizedMethod)
    return { userId: requiredString(input.userId, 'conversation.direct.prepare userId') }
  }
  rejectUnknownFields(input, ['userIds'], normalizedMethod)
  if (!Array.isArray(input.userIds) || input.userIds.length < 2 || input.userIds.length > 500) {
    fail('conversation.group.prepare userIds must contain between 2 and 500 users')
  }
  const userIds = [...new Set(input.userIds.map(value => requiredString(value, 'conversation.group.prepare userId')))]
  if (userIds.length < 2) fail('conversation.group.prepare requires at least two distinct users')
  return { userIds }
}

function validateUser(value, label, { openIM = false } = {}) {
  const user = record(value, label, APP_ERROR_CODES.hostProtocol)
  rejectUnknownFields(
    user,
    ['id', 'name', 'email', 'departmentId', 'status', ...(openIM ? ['openimUserID'] : [])],
    label,
    APP_ERROR_CODES.hostProtocol,
  )
  requiredString(user.id, `${label}.id`, APP_ERROR_CODES.hostProtocol)
  requiredString(user.name, `${label}.name`, APP_ERROR_CODES.hostProtocol)
  optionalNullableString(user.email, `${label}.email`)
  optionalNullableString(user.departmentId, `${label}.departmentId`)
  if (user.status !== undefined && !['active', 'disabled'].includes(user.status)) {
    fail(`${label}.status is invalid`, APP_ERROR_CODES.hostProtocol)
  }
  if (openIM) requiredString(user.openimUserID, `${label}.openimUserID`, APP_ERROR_CODES.hostProtocol)
}

export function validateOpenIMHostOutput(method, value) {
  const normalizedMethod = validateOpenIMHostMethod(method)
  const output = record(value, `${normalizedMethod} output`, APP_ERROR_CODES.hostProtocol)
  if (normalizedMethod === 'session.issue') {
    rejectUnknownFields(output, [
      'available', 'userID', 'imToken', 'expiresIn', 'apiAddr', 'wsAddr',
      'rtcEnabled', 'capabilities', 'user',
    ], 'session.issue output', APP_ERROR_CODES.hostProtocol)
    if (output.available !== true) fail('session.issue output available is invalid', APP_ERROR_CODES.hostProtocol)
    requiredString(output.userID, 'session.issue output userID', APP_ERROR_CODES.hostProtocol)
    requiredString(output.imToken, 'session.issue output imToken', APP_ERROR_CODES.hostProtocol)
    requiredString(output.apiAddr, 'session.issue output apiAddr', APP_ERROR_CODES.hostProtocol)
    requiredString(output.wsAddr, 'session.issue output wsAddr', APP_ERROR_CODES.hostProtocol)
    if (!Number.isFinite(output.expiresIn) || output.expiresIn < 1) fail('session.issue output expiresIn is invalid', APP_ERROR_CODES.hostProtocol)
    if (typeof output.rtcEnabled !== 'boolean') fail('session.issue output rtcEnabled is invalid', APP_ERROR_CODES.hostProtocol)
    const capabilities = record(output.capabilities, 'session.issue output capabilities', APP_ERROR_CODES.hostProtocol)
    rejectUnknownFields(capabilities, ['createGroup'], 'session.issue output capabilities', APP_ERROR_CODES.hostProtocol)
    if (typeof capabilities.createGroup !== 'boolean') fail('session.issue output capabilities.createGroup is invalid', APP_ERROR_CODES.hostProtocol)
    const user = record(output.user, 'session.issue output user', APP_ERROR_CODES.hostProtocol)
    rejectUnknownFields(user, ['id', 'name', 'email', 'orgId'], 'session.issue output user', APP_ERROR_CODES.hostProtocol)
    requiredString(user.id, 'session.issue output user.id', APP_ERROR_CODES.hostProtocol)
    requiredString(user.name, 'session.issue output user.name', APP_ERROR_CODES.hostProtocol)
    optionalNullableString(user.email, 'session.issue output user.email')
    requiredString(user.orgId, 'session.issue output user.orgId', APP_ERROR_CODES.hostProtocol)
    return output
  }
  if (normalizedMethod === 'directory.list') {
    rejectUnknownFields(output, ['departments', 'users', 'nextCursor', 'revision'], 'directory.list output', APP_ERROR_CODES.hostProtocol)
    if (!Array.isArray(output.users) || output.users.length > 200) fail('directory.list output users is invalid', APP_ERROR_CODES.hostProtocol)
    if (!Array.isArray(output.departments) || output.departments.length > 10_000) fail('directory.list output departments is invalid', APP_ERROR_CODES.hostProtocol)
    output.users.forEach((user, index) => validateUser(user, `directory.list output users[${index}]`, { openIM: true }))
    for (const [index, value] of output.departments.entries()) {
      const department = record(value, `directory.list output departments[${index}]`, APP_ERROR_CODES.hostProtocol)
      rejectUnknownFields(department, ['id', 'name', 'parentId', 'userCount'], `directory.list output departments[${index}]`, APP_ERROR_CODES.hostProtocol)
      requiredString(department.id, `directory.list output departments[${index}].id`, APP_ERROR_CODES.hostProtocol)
      requiredString(department.name, `directory.list output departments[${index}].name`, APP_ERROR_CODES.hostProtocol)
      optionalNullableString(department.parentId, `directory.list output departments[${index}].parentId`)
      if (!Number.isInteger(department.userCount) || department.userCount < 0) fail(`directory.list output departments[${index}].userCount is invalid`, APP_ERROR_CODES.hostProtocol)
    }
    optionalNullableString(output.nextCursor, 'directory.list output nextCursor')
    if (output.revision !== undefined) requiredString(output.revision, 'directory.list output revision', APP_ERROR_CODES.hostProtocol)
    return output
  }
  if (normalizedMethod === 'conversation.direct.prepare') {
    rejectUnknownFields(output, ['userID', 'name', 'email'], 'conversation.direct.prepare output', APP_ERROR_CODES.hostProtocol)
    requiredString(output.userID, 'conversation.direct.prepare output userID', APP_ERROR_CODES.hostProtocol)
    requiredString(output.name, 'conversation.direct.prepare output name', APP_ERROR_CODES.hostProtocol)
    optionalNullableString(output.email, 'conversation.direct.prepare output email')
    return output
  }
  rejectUnknownFields(output, ['groupID', 'memberUserIDs'], 'conversation.group.prepare output', APP_ERROR_CODES.hostProtocol)
  requiredString(output.groupID, 'conversation.group.prepare output groupID', APP_ERROR_CODES.hostProtocol)
  if (!Array.isArray(output.memberUserIDs) || output.memberUserIDs.length < 2 || output.memberUserIDs.length > 500) {
    fail('conversation.group.prepare output memberUserIDs is invalid', APP_ERROR_CODES.hostProtocol)
  }
  output.memberUserIDs.forEach((userID, index) => requiredString(userID, `conversation.group.prepare output memberUserIDs[${index}]`, APP_ERROR_CODES.hostProtocol))
  return output
}
