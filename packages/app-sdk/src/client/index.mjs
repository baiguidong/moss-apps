import { createHash, randomUUID } from 'node:crypto'
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
  MOSS_CHANNEL_PROTOCOL,
  getChannelBackendEventPermission,
  getChannelHostMethodPermission,
  requireChannelPermission,
  validateChannelBackendEvent,
  validateChannelBackendEventData,
  validateChannelHostMethod,
  validateChannelHostInput,
  validateChannelProtocol,
} from '../channel/index.mjs'
import {
  requireHostProtocol,
  validateHostData,
  validateHostMember,
  validateHostProtocol,
} from '../host/index.mjs'

const DEFAULT_CHANNEL_TIMEOUT_MS = 30_000
const MAX_CHANNEL_TIMEOUT_MS = 300_000
const MAX_CHANNEL_REPLY_CACHE_ENTRIES = 128

function boundedTimeout(value, fallback = DEFAULT_CHANNEL_TIMEOUT_MS) {
  const parsed = Number(value ?? fallback)
  return Math.max(100, Math.min(Number.isFinite(parsed) ? parsed : fallback, MAX_CHANNEL_TIMEOUT_MS))
}

function channelError(payload, fallbackMessage) {
  const error = payload?.error || {}
  return new AppServiceError(
    error.code || APP_ERROR_CODES.channelUnavailable,
    error.message || fallbackMessage,
    error.details,
  )
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

function channelFingerprint(...parts) {
  return createHash('sha256').update(stableJson(parts)).digest('hex')
}

export class AppBackendClient {
  constructor(options = {}) {
    this.actions = new Map()
    this.controllers = new Map()
    this.channelHandlers = new Map()
    this.channelRequests = new Map()
    this.channelEvents = new Map()
    this.channelEventReplies = new Map()
    this.context = null
    this.channelClosed = true
    this.started = false
    this.onInitialize = options.onInitialize || null
    this.onShutdown = options.onShutdown || null
    this.onFatalError = options.onFatalError || null
    this.channelRequestTimeoutMs = boundedTimeout(options.channelRequestTimeoutMs)
    this.maxPendingChannelRequests = Math.max(1, Number(options.maxPendingChannelRequests) || 32)
    this.maxActiveChannelEvents = Math.max(1, Number(options.maxActiveChannelEvents) || 32)
    this.send = options.send || ((message) => process.send?.(message))
    this.onMessage = options.onMessage || ((handler) => process.on('message', handler))
    this.onDisconnect = options.onDisconnect || ((handler) => {
      if (typeof process.send === 'function') process.once('disconnect', handler)
    })
    this.channel = Object.freeze({
      request: (method, input, requestOptions) => this.requestChannelHost(method, input, requestOptions),
      on: (name, handler) => this.onChannelEvent(name, handler),
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

  onChannelEvent(name, handler) {
    const normalized = validateChannelBackendEvent(name)
    return this.registerHostEvent(MOSS_CHANNEL_PROTOCOL, normalized, handler, {
      permission: getChannelBackendEventPermission(normalized),
      validateData: (data) => validateChannelBackendEventData(normalized, data),
      channel: true,
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
    if (this.channelHandlers.has(key)) {
      throw new TypeError(`Host event handler is already registered: ${protocol} ${name}`)
    }
    const entry = Object.freeze({ handler, ...options })
    this.channelHandlers.set(key, entry)
    return () => {
      if (this.channelHandlers.get(key) === entry) this.channelHandlers.delete(key)
    }
  }

  async requestChannelHost(method, input = {}, options = {}) {
    const normalizedMethod = validateChannelHostMethod(method)
    if (this.context && !this.channelClosed) {
      requireChannelPermission(this.context.permissions, getChannelHostMethodPermission(normalizedMethod))
      requireChannelPermission(this.context.grants ?? this.context.permissions, getChannelHostMethodPermission(normalizedMethod))
    }
    return this.requestHostInternal(
      MOSS_CHANNEL_PROTOCOL,
      normalizedMethod,
      validateChannelHostInput(normalizedMethod, input),
      {
        ...options,
        transport: 'channel',
        unavailableCode: APP_ERROR_CODES.channelUnavailable,
        timeoutCode: APP_ERROR_CODES.channelTimeout,
        protocolCode: APP_ERROR_CODES.channelProtocol,
        label: 'Channel Host',
      },
    )
  }

  async requestHost(protocol, method, input = {}, options = {}) {
    return this.requestHostInternal(
      validateHostProtocol(protocol),
      validateHostMember(method, 'Host method'),
      validateHostData(input, 'Host request input'),
      options,
    )
  }

  async requestHostInternal(protocol, method, input, options = {}) {
    const label = options.label || 'Host protocol'
    const unavailableCode = options.unavailableCode || APP_ERROR_CODES.hostUnavailable
    const timeoutCode = options.timeoutCode || APP_ERROR_CODES.hostTimeout
    const protocolCode = options.protocolCode || APP_ERROR_CODES.hostProtocol
    const transport = options.transport === 'channel' ? 'channel' : 'host'
    if (!this.context || this.channelClosed) {
      return Promise.reject(new AppServiceError(unavailableCode, `${label} is not initialized`))
    }
    if (this.channelRequests.size >= this.maxPendingChannelRequests) {
      return Promise.reject(new AppServiceError(unavailableCode, `${label} request limit reached`))
    }
    try {
      requireHostProtocol(this.context.protocols, protocol)
    } catch (error) {
      if (error?.code === APP_ERROR_CODES.hostUnavailable) {
        throw new AppServiceError(unavailableCode, `App Backend was not initialized with protocol: ${protocol}`)
      }
      throw error
    }
    const requestId = String(options.requestId || randomUUID())
    if (!requestId || requestId.length > 128 || this.channelRequests.has(requestId)) {
      return Promise.reject(new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} request id is invalid or duplicated`))
    }
    const timeoutMs = boundedTimeout(options.timeoutMs, this.channelRequestTimeoutMs)
    let message
    try {
      message = createEnvelope(`${transport}.request`, {
        protocol,
        method,
        input,
        ...this.identity(),
      }, { id: requestId })
      validateEnvelope(message, { allowedTypes: [`${transport}.request`] })
    } catch (error) {
      return Promise.reject(new AppServiceError(
        APP_ERROR_CODES.invalidInput,
        `${label} request cannot be serialized: ${error.message}`,
      ))
    }
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        const pending = this.channelRequests.get(requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        pending.signal?.removeEventListener('abort', pending.abortHandler)
        this.channelRequests.delete(requestId)
        if (error) reject(error)
        else resolve(result)
      }
      const timer = setTimeout(() => {
        try {
          this.send(createEnvelope(`${transport}.cancel`, {
            protocol,
            requestId,
            ...this.identity(),
          }))
        } catch {} finally {
          finish(new AppServiceError(timeoutCode, `${label} request timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)
      timer.unref?.()
      const abortHandler = () => {
        try {
          this.send(createEnvelope(`${transport}.cancel`, {
            protocol,
            requestId,
            ...this.identity(),
          }))
        } catch {} finally {
          finish(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Channel Host request canceled'))
        }
      }
      this.channelRequests.set(requestId, {
        resolve,
        reject,
        timer,
        signal: options.signal,
        abortHandler,
        finish,
        protocol,
        transport,
        unavailableCode,
        protocolCode,
        label,
      })
      if (options.signal?.aborted) {
        abortHandler()
        return
      }
      options.signal?.addEventListener('abort', abortHandler, { once: true })
      try {
        this.send(message)
      } catch (error) {
        finish(new AppServiceError(unavailableCode, `Cannot call ${label}: ${error.message}`))
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
    return {
      generation: this.context?.generation,
      launchToken: this.context?.launchToken,
    }
  }

  hasCurrentIdentity(payload = {}) {
    return Boolean(
      this.context
      && payload.generation === this.context.generation
      && payload.launchToken === this.context.launchToken
    )
  }

  closeChannel(error = new AppServiceError(APP_ERROR_CODES.channelUnavailable, 'Channel Host disconnected')) {
    this.channelClosed = true
    for (const pending of [...this.channelRequests.values()]) pending.finish(error)
    for (const active of this.channelEvents.values()) {
      active.canceled = true
      active.retryMessage = null
      active.controller.abort(error)
    }
    this.channelEvents.clear()
    this.channelEventReplies.clear()
  }

  handleChannelResponse(message) {
    return this.handleHostResponse(message, 'channel')
  }

  handleHostResponse(message, transport = 'host') {
    const payload = message.payload || {}
    let protocol
    try { protocol = validateHostProtocol(payload.protocol) } catch (error) {
      this.log('error', error.message)
      return
    }
    const requestId = String(payload.requestId || message.id || '')
    const pending = this.channelRequests.get(requestId)
    if (!pending) return
    if (pending.protocol !== protocol || pending.transport !== transport) {
      this.log('warn', `Rejected mismatched Host response: ${protocol}`)
      return
    }
    if (payload.ok === true) pending.finish(null, payload.result)
    else pending.finish(transport === 'channel'
      ? channelError(payload, 'Channel Host request failed')
      : hostError(payload, 'Host protocol request failed', pending.unavailableCode))
  }

  async handleChannelEvent(message) {
    return this.handleHostEvent(message, 'channel')
  }

  async handleHostEvent(message, transport = 'host') {
    const payload = message.payload || {}
    if (this.channelClosed) return
    let protocol
    try { protocol = validateHostProtocol(payload.protocol) } catch (error) {
      this.sendHostEventResponse(message, transport, false, undefined, error, { cache: false })
      return
    }
    const eventId = String(payload.eventId || message.id || '')
    const eventKey = hostHandlerKey(protocol, eventId)
    const fingerprint = channelFingerprint(transport, payload.protocol, payload.name, payload.data)
    const cached = this.channelEventReplies.get(eventKey)
    if (cached) {
      if (cached.fingerprint === fingerprint) this.send(cached.response)
      else this.sendHostEventResponse(message, transport, false, undefined, new AppServiceError(
        transport === 'channel' ? APP_ERROR_CODES.channelProtocol : APP_ERROR_CODES.hostProtocol,
        `Host event id was reused with a different payload: ${eventId}`,
      ), { cache: false, fingerprint })
      return
    }
    const existing = this.channelEvents.get(eventKey)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        this.sendHostEventResponse(message, transport, false, undefined, new AppServiceError(
          transport === 'channel' ? APP_ERROR_CODES.channelProtocol : APP_ERROR_CODES.hostProtocol,
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
      if (transport === 'channel') {
        validateChannelProtocol(protocol)
        name = validateChannelBackendEvent(payload.name)
      } else {
        name = validateHostMember(payload.name, `${protocol} event`)
      }
      try {
        requireHostProtocol(this.context?.protocols, protocol)
      } catch (error) {
        if (transport === 'channel' && error?.code === APP_ERROR_CODES.hostUnavailable) {
          throw new AppServiceError(
            APP_ERROR_CODES.channelUnavailable,
            `App Backend was not initialized with protocol: ${protocol}`,
          )
        }
        throw error
      }
      entry = this.channelHandlers.get(hostHandlerKey(protocol, name))
      if (entry?.permission) requireChannelPermission(this.context.permissions, entry.permission)
      if (entry?.permission) requireChannelPermission(this.context.grants ?? this.context.permissions, entry.permission)
      if (entry?.validateData) entry.validateData(payload.data)
      else validateHostData(payload.data, `${protocol} ${name} data`)
    } catch (error) {
      this.sendHostEventResponse(message, transport, false, undefined, error, { fingerprint })
      return
    }
    if (!entry) {
      this.sendHostEventResponse(message, transport, false, undefined, new AppServiceError(
        transport === 'channel' ? APP_ERROR_CODES.channelUnavailable : APP_ERROR_CODES.hostUnavailable,
        `No Host event handler is registered for ${protocol} ${name}`,
      ), { fingerprint })
      return
    }
    if (this.channelEvents.size >= this.maxActiveChannelEvents) {
      this.sendHostEventResponse(message, transport, false, undefined, new AppServiceError(
        transport === 'channel' ? APP_ERROR_CODES.channelUnavailable : APP_ERROR_CODES.hostUnavailable,
        'Host event concurrency limit reached',
      ), { cache: false, fingerprint })
      return
    }
    const controller = new AbortController()
    const active = {
      controller,
      fingerprint,
      canceled: false,
      responded: false,
      retryMessage: null,
      transport,
    }
    this.channelEvents.set(eventKey, active)
    try {
      const result = await entry.handler(payload.data, {
        ...this.context,
        host: this.host,
        channel: this.channel,
        signal: controller.signal,
        eventId,
        name,
        protocol,
      })
      if (this.channelEvents.get(eventKey) === active) {
        this.sendHostEventResponse(message, transport, true, result, undefined, { fingerprint })
        active.responded = true
      }
    } catch (error) {
      if (this.channelEvents.get(eventKey) === active && !active.canceled) {
        this.sendHostEventResponse(message, transport, false, undefined, error, { fingerprint })
        active.responded = true
      }
    } finally {
      if (this.channelEvents.get(eventKey) === active) {
        this.channelEvents.delete(eventKey)
        if (active.retryMessage && !active.responded && !this.channelClosed) {
          queueMicrotask(() => {
            void this.handleHostEvent(active.retryMessage, active.transport).catch((error) => this.handleFatalError(error))
          })
        }
      }
    }
  }

  sendChannelEventResponse(message, ok, result, error, options = {}) {
    return this.sendHostEventResponse(message, 'channel', ok, result, error, options)
  }

  sendHostEventResponse(message, transport, ok, result, error, options = {}) {
    const protocol = String(message.payload?.protocol || '')
    const eventId = String(message.payload?.eventId || message.id || '')
    const eventKey = hostHandlerKey(protocol, eventId)
    const fingerprint = options.fingerprint || channelFingerprint(
      transport,
      message.payload?.protocol,
      message.payload?.name,
      message.payload?.data,
    )
    const unavailableCode = transport === 'channel' ? APP_ERROR_CODES.channelUnavailable : APP_ERROR_CODES.hostUnavailable
    const protocolCode = transport === 'channel' ? APP_ERROR_CODES.channelProtocol : APP_ERROR_CODES.hostProtocol
    let response = createEnvelope(`${transport}.event.response`, {
      protocol,
      eventId,
      ok,
      ...(ok ? { result } : { error: serializeError(error, unavailableCode) }),
      ...this.identity(),
    }, { id: eventId })
    try {
      validateEnvelope(response, { allowedTypes: [`${transport}.event.response`] })
    } catch (serializationError) {
      response = createEnvelope(`${transport}.event.response`, {
        protocol,
        eventId,
        ok: false,
        error: serializeError(serializationError, protocolCode),
        ...this.identity(),
      }, { id: eventId })
    }
    if (options.cache !== false) {
      this.channelEventReplies.set(eventKey, { fingerprint, response })
      if (this.channelEventReplies.size > MAX_CHANNEL_REPLY_CACHE_ENTRIES) {
        this.channelEventReplies.delete(this.channelEventReplies.keys().next().value)
      }
    }
    this.send(response)
  }

  start(actions = {}) {
    if (this.started) return this
    for (const [name, handler] of Object.entries(actions)) this.registerAction(name, handler)
    this.started = true
    this.onMessage((raw) => {
      void this.handleMessage(raw).catch((error) => this.handleFatalError(error))
    })
    this.onDisconnect(() => {
      this.closeChannel(new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Host disconnected'))
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
        state: 'error',
        details: serializeError(error),
        ...this.identity(),
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
      this.context = Object.freeze({ ...payload, host: this.host, channel: this.channel })
      this.channelClosed = false
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
      this.closeChannel(new AppServiceError(APP_ERROR_CODES.channelUnavailable, 'App Backend is shutting down'))
      if (this.onShutdown) await this.onShutdown(this.context)
      setImmediate(() => process.exit(0))
      return
    }
    if (message.type === 'channel.response' || message.type === 'host.response') {
      if (!this.hasCurrentIdentity(payload)) {
        this.log('warn', 'Rejected stale Host response')
        return
      }
      this.handleHostResponse(message, message.type.startsWith('channel.') ? 'channel' : 'host')
      return
    }
    if (message.type === 'channel.event.cancel' || message.type === 'host.event.cancel') {
      if (!this.hasCurrentIdentity(payload)) {
        this.log('warn', 'Rejected stale Host event cancellation')
        return
      }
      let protocol
      try {
        protocol = message.type.startsWith('channel.')
          ? validateChannelProtocol(payload.protocol)
          : validateHostProtocol(payload.protocol)
      } catch (error) {
        this.log('error', error.message)
        return
      }
      const eventId = String(payload.eventId || '')
      const active = this.channelEvents.get(hostHandlerKey(protocol, eventId))
      if (active) {
        active.canceled = true
        active.controller.abort(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Host event canceled'))
      }
      return
    }
    if (message.type === 'channel.event' || message.type === 'host.event') {
      if (!this.hasCurrentIdentity(payload)) {
        this.log('warn', 'Rejected stale Host event')
        return
      }
      await this.handleHostEvent(message, message.type.startsWith('channel.') ? 'channel' : 'host')
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
      const result = await handler(payload.input, {
        ...this.context,
        host: this.host,
        channel: this.channel,
        signal: controller.signal,
        requestId: message.id,
        emit: (name, data) => this.emit(name, data),
        log: (level, text, details) => this.log(level, text, details),
      })
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
