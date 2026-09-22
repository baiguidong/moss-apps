import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  APP_ERROR_CODES,
  AppServiceError,
  BACKEND_MESSAGE_TYPES,
  HOST_MESSAGE_TYPES,
  createEnvelope,
  serializeError,
  validateEnvelope,
} from '../protocol/index.mjs'
import {
  ACCOUNT_BACKEND_EVENT_PERMISSIONS,
  ACCOUNT_HOST_METHOD_PERMISSIONS,
  MOSS_ACCOUNT_PROTOCOL,
  validateAccountBackendEvent,
  validateAccountBackendEventData,
  validateAccountHostInput,
  validateAccountHostMethod,
} from '../account/index.mjs'
import {
  AGENT_BACKEND_EVENT_PERMISSIONS,
  AGENT_HOST_METHOD_PERMISSIONS,
  MOSS_AGENT_PROTOCOL,
  validateAgentBackendEvent,
  validateAgentBackendEventData,
  validateAgentHostInput,
  validateAgentHostMethod,
} from '../agent/index.mjs'
import {
  DESKTOP_HOST_METHOD_PERMISSIONS,
  MOSS_DESKTOP_PROTOCOL,
  validateDesktopHostInput,
  validateDesktopHostMethod,
} from '../desktop/index.mjs'
import {
  MOSS_REMOTE_PROTOCOL,
  REMOTE_HOST_METHOD_PERMISSIONS,
  validateRemoteHostInput,
  validateRemoteHostMethod,
} from '../remote/index.mjs'
import {
  requireHostPermission,
  requireHostProtocol,
  validateHostData,
  validateHostMember,
  validateHostProtocol,
} from '../host/index.mjs'

const DEFAULT_HOST_TIMEOUT_MS = 30_000
const MAX_HOST_TIMEOUT_MS = 300_000
const MAX_HOST_REPLY_CACHE_ENTRIES = 128

function boundedTimeout(value, fallback = DEFAULT_HOST_TIMEOUT_MS) {
  const parsed = Number(value ?? fallback)
  return Math.max(100, Math.min(Number.isFinite(parsed) ? parsed : fallback, MAX_HOST_TIMEOUT_MS))
}

function hostError(payload, fallbackMessage, fallbackCode = APP_ERROR_CODES.hostUnavailable) {
  const error = payload?.error || {}
  return new AppServiceError(error.code || fallbackCode, error.message || fallbackMessage, error.details)
}

function hostHandlerKey(protocol, name) {
  return `${protocol}\u0000${name}`
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function hostFingerprint(...parts) {
  return createHash('sha256').update(stableJson(parts)).digest('hex')
}

export class AppBackendClient {
  constructor(options = {}) {
    this.actions = new Map()
    this.controllers = new Map()
    this.hostHandlers = new Map()
    this.hostRequests = new Map()
    this.hostEvents = new Map()
    this.hostEventReplies = new Map()
    this.actionContext = new AsyncLocalStorage()
    this.context = null
    this.hostClosed = true
    this.started = false
    this.onInitialize = options.onInitialize || null
    this.onShutdown = options.onShutdown || null
    this.onFatalError = options.onFatalError || null
    this.hostRequestTimeoutMs = boundedTimeout(options.hostRequestTimeoutMs)
    this.maxPendingHostRequests = Math.max(1, Number(options.maxPendingHostRequests) || 32)
    this.maxActiveHostEvents = Math.max(1, Number(options.maxActiveHostEvents) || 32)
    this.send = options.send || ((message) => process.send?.(message))
    this.onMessage = options.onMessage || ((handler) => process.on('message', handler))
    this.onDisconnect = options.onDisconnect || ((handler) => {
      if (typeof process.send === 'function') process.once('disconnect', handler)
    })
    this.account = Object.freeze({
      request: (method, input, requestOptions) => this.requestAccountHost(method, input, requestOptions),
      on: (name, handler) => this.onAccountEvent(name, handler),
    })
    this.agent = Object.freeze({
      request: (method, input, requestOptions) => this.requestAgentHost(method, input, requestOptions),
      on: (name, handler) => this.onAgentEvent(name, handler),
    })
    this.desktop = Object.freeze({
      request: (method, input, requestOptions) => this.requestDesktopHost(method, input, requestOptions),
    })
    this.remote = Object.freeze({
      request: (method, input, requestOptions) => this.requestRemoteHost(method, input, requestOptions),
    })
    this.host = Object.freeze({
      request: (protocol, method, input, requestOptions) => this.requestHost(protocol, method, input, requestOptions),
      on: (protocol, name, handler) => this.onHostEvent(protocol, name, handler),
    })
  }

  registerAction(name, handler) {
    if (!name || typeof handler !== 'function') throw new TypeError('registerAction requires a name and handler')
    this.actions.set(name, handler)
    return this
  }

  onAccountEvent(name, handler) {
    const normalized = validateAccountBackendEvent(name)
    return this.registerHostEvent(MOSS_ACCOUNT_PROTOCOL, normalized, handler, {
      permission: ACCOUNT_BACKEND_EVENT_PERMISSIONS[normalized],
      validateData: (data) => validateAccountBackendEventData(normalized, data),
    })
  }

  onAgentEvent(name, handler) {
    const normalized = validateAgentBackendEvent(name)
    return this.registerHostEvent(MOSS_AGENT_PROTOCOL, normalized, handler, {
      permission: AGENT_BACKEND_EVENT_PERMISSIONS[normalized],
      validateData: (data) => validateAgentBackendEventData(normalized, data),
    })
  }

  onHostEvent(protocol, name, handler) {
    return this.registerHostEvent(
      validateHostProtocol(protocol),
      validateHostMember(name, 'Host event'),
      handler,
    )
  }

  registerHostEvent(protocol, name, handler, options = {}) {
    if (typeof handler !== 'function') throw new TypeError('Host event handler must be a function')
    const key = hostHandlerKey(protocol, name)
    if (this.hostHandlers.has(key)) throw new TypeError(`Host event handler is already registered: ${protocol} ${name}`)
    const entry = Object.freeze({ handler, ...options })
    this.hostHandlers.set(key, entry)
    return () => {
      if (this.hostHandlers.get(key) === entry) this.hostHandlers.delete(key)
    }
  }

  requestAccountHost(method, input = {}, options = {}) {
    const normalizedMethod = validateAccountHostMethod(method)
    return this.requestTypedHost(
      MOSS_ACCOUNT_PROTOCOL,
      normalizedMethod,
      validateAccountHostInput(normalizedMethod, input),
      ACCOUNT_HOST_METHOD_PERMISSIONS[normalizedMethod],
      options,
      'Account Host',
    )
  }

  requestAgentHost(method, input = {}, options = {}) {
    const normalizedMethod = validateAgentHostMethod(method)
    return this.requestTypedHost(
      MOSS_AGENT_PROTOCOL,
      normalizedMethod,
      validateAgentHostInput(normalizedMethod, input),
      AGENT_HOST_METHOD_PERMISSIONS[normalizedMethod],
      options,
      'Agent Host',
    )
  }

  requestDesktopHost(method, input = {}, options = {}) {
    const normalizedMethod = validateDesktopHostMethod(method)
    return this.requestTypedHost(
      MOSS_DESKTOP_PROTOCOL,
      normalizedMethod,
      validateDesktopHostInput(normalizedMethod, input),
      DESKTOP_HOST_METHOD_PERMISSIONS[normalizedMethod],
      options,
      'Desktop Host',
    )
  }

  requestRemoteHost(method, input = {}, options = {}) {
    const normalizedMethod = validateRemoteHostMethod(method)
    return this.requestTypedHost(
      MOSS_REMOTE_PROTOCOL,
      normalizedMethod,
      validateRemoteHostInput(normalizedMethod, input),
      REMOTE_HOST_METHOD_PERMISSIONS[normalizedMethod],
      options,
      'Remote Host',
    )
  }

  requestTypedHost(protocol, method, input, permission, options, label) {
    if (this.context && !this.hostClosed) {
      requireHostPermission(this.context.permissions, permission)
      requireHostPermission(this.context.grants ?? this.context.permissions, permission, { source: 'grant' })
    }
    return this.requestHostInternal(protocol, method, input, { ...options, label })
  }

  requestHost(protocol, method, input = {}, options = {}) {
    return this.requestHostInternal(
      validateHostProtocol(protocol),
      validateHostMember(method, 'Host method'),
      validateHostData(input, 'Host request input'),
      options,
    )
  }

  async requestHostInternal(protocol, method, input, options = {}) {
    const label = options.label || 'Host protocol'
    if (!this.context || this.hostClosed) {
      throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, `${label} is not initialized`)
    }
    if (this.hostRequests.size >= this.maxPendingHostRequests) {
      throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, `${label} request limit reached`)
    }
    requireHostProtocol(this.context.protocols, protocol)
    const requestId = String(options.requestId || randomUUID())
    if (!requestId || requestId.length > 128 || this.hostRequests.has(requestId)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} request id is invalid or duplicated`)
    }
    const timeoutMs = boundedTimeout(options.timeoutMs, this.hostRequestTimeoutMs)
    let message
    try {
      message = createEnvelope('host.request', {
        protocol,
        method,
        input,
        timeoutMs,
        actionRequestId: this.actionContext.getStore()?.requestId,
        ...this.identity(),
      }, { id: requestId })
      validateEnvelope(message, { allowedTypes: ['host.request'] })
    } catch (error) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} request cannot be serialized: ${error.message}`)
    }
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        const pending = this.hostRequests.get(requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        pending.signal?.removeEventListener('abort', pending.abortHandler)
        this.hostRequests.delete(requestId)
        if (error) reject(error)
        else resolve(result)
      }
      const cancel = (error) => {
        try {
          this.send(createEnvelope('host.cancel', { protocol, requestId, ...this.identity() }))
        } catch {} finally {
          finish(error)
        }
      }
      const timer = setTimeout(() => cancel(
        new AppServiceError(APP_ERROR_CODES.hostTimeout, `${label} request timed out after ${timeoutMs}ms`),
      ), timeoutMs)
      timer.unref?.()
      const abortHandler = () => cancel(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Host request canceled'))
      this.hostRequests.set(requestId, { resolve, reject, timer, signal: options.signal, abortHandler, finish, protocol })
      if (options.signal?.aborted) return abortHandler()
      options.signal?.addEventListener('abort', abortHandler, { once: true })
      try {
        this.send(message)
      } catch (error) {
        finish(new AppServiceError(APP_ERROR_CODES.hostUnavailable, `Cannot call ${label}: ${error.message}`))
      }
    })
  }

  emit(name, data) {
    this.send(createEnvelope('event.emit', { name, data, ...this.identity() }))
  }

  log(level, message, details) {
    this.send(createEnvelope('log.write', { level, message, details, ...this.identity() }))
  }

  status(state, details) {
    this.send(createEnvelope('service.status', { state, details, ...this.identity() }))
  }

  identity() {
    return { generation: this.context?.generation, launchToken: this.context?.launchToken }
  }

  hasCurrentIdentity(payload = {}) {
    return Boolean(this.context
      && payload.generation === this.context.generation
      && payload.launchToken === this.context.launchToken)
  }

  closeHost(error = new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Host disconnected')) {
    this.hostClosed = true
    for (const pending of [...this.hostRequests.values()]) pending.finish(error)
    for (const active of this.hostEvents.values()) {
      active.canceled = true
      active.retryMessage = null
      active.controller.abort(error)
    }
    this.hostEvents.clear()
    this.hostEventReplies.clear()
  }

  handleHostResponse(message) {
    const payload = message.payload || {}
    let protocol
    try { protocol = validateHostProtocol(payload.protocol) } catch (error) {
      this.log('error', error.message)
      return
    }
    const requestId = String(payload.requestId || message.id || '')
    const pending = this.hostRequests.get(requestId)
    if (!pending) return
    if (pending.protocol !== protocol) {
      this.log('warn', `Rejected mismatched Host response: ${protocol}`)
      return
    }
    if (payload.ok === true) pending.finish(null, payload.result)
    else pending.finish(hostError(payload, 'Host protocol request failed'))
  }

  async handleHostEvent(message) {
    const payload = message.payload || {}
    if (this.hostClosed) return
    let protocol
    try { protocol = validateHostProtocol(payload.protocol) } catch (error) {
      this.sendHostEventResponse(message, false, undefined, error, { cache: false })
      return
    }
    const eventId = String(payload.eventId || message.id || '')
    const eventKey = hostHandlerKey(protocol, eventId)
    const fingerprint = hostFingerprint(payload.protocol, payload.name, payload.data)
    const cached = this.hostEventReplies.get(eventKey)
    if (cached) {
      if (cached.fingerprint === fingerprint) this.send(cached.response)
      else this.sendHostEventResponse(message, false, undefined, new AppServiceError(
        APP_ERROR_CODES.hostProtocol,
        `Host event id was reused with a different payload: ${eventId}`,
      ), { cache: false, fingerprint })
      return
    }
    const existing = this.hostEvents.get(eventKey)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        this.sendHostEventResponse(message, false, undefined, new AppServiceError(
          APP_ERROR_CODES.hostProtocol,
          `Host event id was reused with a different payload: ${eventId}`,
        ), { cache: false, fingerprint })
      } else if (existing.canceled) {
        existing.retryMessage = message
      }
      return
    }
    let name
    let entry
    try {
      name = validateHostMember(payload.name, `${protocol} event`)
      requireHostProtocol(this.context?.protocols, protocol)
      entry = this.hostHandlers.get(hostHandlerKey(protocol, name))
      if (entry?.permission) {
        requireHostPermission(this.context.permissions, entry.permission)
        requireHostPermission(this.context.grants ?? this.context.permissions, entry.permission, { source: 'grant' })
      }
      if (entry?.validateData) entry.validateData(payload.data)
      else validateHostData(payload.data, `${protocol} ${name} data`)
    } catch (error) {
      this.sendHostEventResponse(message, false, undefined, error, { fingerprint })
      return
    }
    if (!entry) {
      this.sendHostEventResponse(message, false, undefined, new AppServiceError(
        APP_ERROR_CODES.hostUnavailable,
        `No Host event handler is registered for ${protocol} ${name}`,
      ), { fingerprint })
      return
    }
    if (this.hostEvents.size >= this.maxActiveHostEvents) {
      this.sendHostEventResponse(message, false, undefined, new AppServiceError(
        APP_ERROR_CODES.hostUnavailable,
        'Host event concurrency limit reached',
      ), { cache: false, fingerprint })
      return
    }
    const controller = new AbortController()
    const active = { controller, fingerprint, canceled: false, responded: false, retryMessage: null }
    this.hostEvents.set(eventKey, active)
    try {
      const result = await entry.handler(payload.data, {
        ...this.context,
        host: this.host,
        signal: controller.signal,
        eventId,
        name,
        protocol,
      })
      if (this.hostEvents.get(eventKey) === active) {
        this.sendHostEventResponse(message, true, result, undefined, { fingerprint })
        active.responded = true
      }
    } catch (error) {
      if (this.hostEvents.get(eventKey) === active && !active.canceled) {
        this.sendHostEventResponse(message, false, undefined, error, { fingerprint })
        active.responded = true
      }
    } finally {
      if (this.hostEvents.get(eventKey) === active) {
        this.hostEvents.delete(eventKey)
        if (active.retryMessage && !active.responded && !this.hostClosed) {
          queueMicrotask(() => void this.handleHostEvent(active.retryMessage).catch((error) => this.handleFatalError(error)))
        }
      }
    }
  }

  sendHostEventResponse(message, ok, result, error, options = {}) {
    const protocol = String(message.payload?.protocol || '')
    const eventId = String(message.payload?.eventId || message.id || '')
    const eventKey = hostHandlerKey(protocol, eventId)
    const fingerprint = options.fingerprint || hostFingerprint(
      message.payload?.protocol,
      message.payload?.name,
      message.payload?.data,
    )
    let response = createEnvelope('host.event.response', {
      protocol,
      eventId,
      ok,
      ...(ok ? { result } : { error: serializeError(error, APP_ERROR_CODES.hostUnavailable) }),
      ...this.identity(),
    }, { id: eventId })
    try {
      validateEnvelope(response, { allowedTypes: ['host.event.response'] })
    } catch (serializationError) {
      response = createEnvelope('host.event.response', {
        protocol,
        eventId,
        ok: false,
        error: serializeError(serializationError, APP_ERROR_CODES.hostProtocol),
        ...this.identity(),
      }, { id: eventId })
    }
    if (options.cache !== false) {
      this.hostEventReplies.set(eventKey, { fingerprint, response })
      if (this.hostEventReplies.size > MAX_HOST_REPLY_CACHE_ENTRIES) {
        this.hostEventReplies.delete(this.hostEventReplies.keys().next().value)
      }
    }
    this.send(response)
  }

  start(actions = {}) {
    if (this.started) return this
    for (const [name, handler] of Object.entries(actions)) this.registerAction(name, handler)
    this.started = true
    this.onMessage((raw) => void this.handleMessage(raw).catch((error) => this.handleFatalError(error)))
    this.onDisconnect(() => {
      this.closeHost()
      setImmediate(() => process.exit(0))
    })
    this.send(createEnvelope('service.hello', {
      appId: process.env.MOSS_APP_ID,
      version: process.env.MOSS_APP_VERSION,
      apiVersion: 1,
      instanceId: process.env.MOSS_APP_INSTANCE_ID,
      generation: Number(process.env.MOSS_APP_GENERATION),
      launchToken: process.env.MOSS_APP_LAUNCH_TOKEN,
    }))
    return this
  }

  handleFatalError(error) {
    try {
      this.send(createEnvelope('service.status', {
        state: 'error', details: serializeError(error), ...this.identity(),
      }))
    } catch {}
    if (this.onFatalError) {
      try {
        Promise.resolve(this.onFatalError(error)).catch(() => {
          if (typeof process.send === 'function') setImmediate(() => process.exit(1))
        })
      } catch {
        if (typeof process.send === 'function') setImmediate(() => process.exit(1))
      }
    } else if (typeof process.send === 'function') {
      setImmediate(() => process.exit(1))
    }
  }

  async handleMessage(raw) {
    let message
    try {
      message = validateEnvelope(raw, { allowedTypes: HOST_MESSAGE_TYPES })
    } catch (error) {
      this.log('error', error.message)
      return
    }
    const payload = message.payload || {}
    if (message.type === 'service.init') {
      if (this.context) throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'App Backend was initialized more than once')
      this.context = Object.freeze({
        ...payload,
        host: this.host,
        account: this.account,
        agent: this.agent,
        desktop: this.desktop,
        remote: this.remote,
      })
      this.hostClosed = false
      if (this.onInitialize) await this.onInitialize(this.context)
      this.send(createEnvelope('service.ready', { ...this.identity() }, { id: message.id }))
      return
    }
    if (message.type === 'service.ping') {
      this.send(createEnvelope('service.pong', { ...this.identity() }, { id: message.id }))
      return
    }
    if (message.type === 'service.shutdown') {
      this.send(createEnvelope('service.status', { state: 'stopping', ...this.identity() }, { id: message.id }))
      this.closeHost(new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App Backend is shutting down'))
      if (this.onShutdown) await this.onShutdown(this.context)
      setImmediate(() => process.exit(0))
      return
    }
    if (message.type === 'host.response') {
      if (!this.hasCurrentIdentity(payload)) return this.log('warn', 'Rejected stale Host response')
      this.handleHostResponse(message)
      return
    }
    if (message.type === 'host.event.cancel') {
      if (!this.hasCurrentIdentity(payload)) return this.log('warn', 'Rejected stale Host event cancellation')
      let protocol
      try { protocol = validateHostProtocol(payload.protocol) } catch (error) {
        this.log('error', error.message)
        return
      }
      const active = this.hostEvents.get(hostHandlerKey(protocol, String(payload.eventId || '')))
      if (active) {
        active.canceled = true
        active.controller.abort(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Host event canceled'))
      }
      return
    }
    if (message.type === 'host.event') {
      if (!this.hasCurrentIdentity(payload)) return this.log('warn', 'Rejected stale Host event')
      await this.handleHostEvent(message)
      return
    }
    if (message.type === 'action.cancel') {
      this.controllers.get(payload.requestId)?.abort(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Action canceled'))
      return
    }
    if (message.type !== 'action.invoke') return
    const handler = this.actions.get(payload.name)
    if (!handler) {
      this.send(createEnvelope('action.error', {
        requestId: message.id,
        error: serializeError(new AppServiceError(APP_ERROR_CODES.actionNotFound, `Unknown action: ${payload.name}`)),
        ...this.identity(),
      }, { id: message.id }))
      return
    }
    const controller = new AbortController()
    this.controllers.set(message.id, controller)
    try {
      const result = await this.actionContext.run({ requestId: message.id }, () => handler(payload.input, {
          ...this.context,
          principal: payload.principal || null,
          host: this.host,
          account: this.account,
          agent: this.agent,
          desktop: this.desktop,
          remote: this.remote,
          signal: controller.signal,
          requestId: message.id,
          emit: (name, data) => this.emit(name, data),
          log: (level, text, details) => this.log(level, text, details),
        }))
      this.send(createEnvelope('action.result', { requestId: message.id, result, ...this.identity() }, { id: message.id }))
    } catch (error) {
      this.send(createEnvelope('action.error', {
        requestId: message.id,
        error: serializeError(error),
        ...this.identity(),
      }, { id: message.id }))
    } finally {
      this.controllers.delete(message.id)
    }
  }
}

export function defineAppBackend(actions, options = {}) {
  return new AppBackendClient(options).start(actions)
}

export { BACKEND_MESSAGE_TYPES }
