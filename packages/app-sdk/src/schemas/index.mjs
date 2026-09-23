import fs from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import semver from 'semver'
import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'
import manifestSchema from './app-manifest.schema.json' with { type: 'json' }

export const APP_MANIFEST_SCHEMA = manifestSchema
export const APP_HOST_API_VERSION = '2.1.0'

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validateManifestSchema = ajv.compile(APP_MANIFEST_SCHEMA)

export function ensureSafeRelativePath(value, fieldName = 'path') {
  const raw = String(value || '').trim()
  const portable = raw.replaceAll('\\', '/')
  const normalized = path.posix.normalize(portable)
  if (
    !raw ||
    raw.includes('\0') ||
    path.posix.isAbsolute(portable) ||
    /^[A-Za-z]:\//.test(portable) ||
    portable.startsWith('//') ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `${fieldName} must stay inside the App package`)
  }
  return normalized
}

function formatAjvErrors(errors = []) {
  return errors.map((entry) => `${entry.instancePath || '/'} ${entry.message}`).join('; ')
}

function normalizeUi(ui) {
  if (!ui) return undefined
  return {
    entry: ensureSafeRelativePath(ui.entry, 'ui.entry'),
    window: {
      width: Number(ui.window?.width) || 1100,
      height: Number(ui.window?.height) || 760,
      resizable: ui.window?.resizable !== false,
    },
  }
}

function normalizeContributionPermission(item, requestedPermissions, label) {
  if (!item.permission) return {}
  if (!requestedPermissions.has(item.permission)) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidManifest,
      `${label} references undeclared permission: ${item.permission}`,
    )
  }
  return { permission: item.permission }
}

function normalizeContributionList(items, kind, normalize, ids = new Set()) {
  return (items || []).map((item) => {
    if (ids.has(item.id)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate App contribution id: ${item.id}`)
    }
    ids.add(item.id)
    return normalize(item)
  })
}

function normalizeContributes(contributes, manifest) {
  if (!contributes) return undefined
  const contributionIds = new Set()
  const requestedPermissions = new Set(manifest.permissions || [])
  const actions = new Map(manifest.backend?.actions?.map((action) => [action.name, action]) || [])
  const requireAction = (action, label) => {
    if (!actions.has(action)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `${label} references unknown Backend action: ${action}`)
    }
    return actions.get(action)
  }
  const views = normalizeContributionList(contributes.views, 'view', (view) => ({
    id: view.id,
    title: view.title.trim(),
    route: view.route || '#/',
    location: view.location || 'hidden',
    icon: String(view.icon || '').trim(),
    order: Number(view.order) || 0,
    ...normalizeContributionPermission(view, requestedPermissions, `view ${view.id}`),
  }), contributionIds)
  if (views.length && !manifest.ui) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'View contributions require an App UI')
  }
  const viewIds = new Set(views.map((view) => view.id))
  const settings = normalizeContributionList(contributes.settings, 'settings', (setting) => {
    if (!viewIds.has(setting.viewId)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `settings ${setting.id} references unknown view: ${setting.viewId}`)
    }
    return {
      id: setting.id,
      title: setting.title.trim(),
      viewId: setting.viewId,
      order: Number(setting.order) || 0,
      ...normalizeContributionPermission(setting, requestedPermissions, `settings ${setting.id}`),
    }
  }, contributionIds)
  const commands = normalizeContributionList(contributes.commands, 'command', (command) => {
    const action = requireAction(command.action, `command ${command.id}`)
    const inputSchema = command.inputSchema
      ? ensureSafeRelativePath(command.inputSchema, `command ${command.id} inputSchema`)
      : undefined
    if (inputSchema && inputSchema !== action.inputSchema) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `command ${command.id} inputSchema must match its Backend action`)
    }
    return {
      id: command.id,
      title: command.title.trim(),
      description: String(command.description || '').trim(),
      action: command.action,
      ...(inputSchema ? { inputSchema } : {}),
      ...normalizeContributionPermission(command, requestedPermissions, `command ${command.id}`),
    }
  }, contributionIds)
  const tools = normalizeContributionList(contributes.tools, 'tool', (tool) => {
    const action = requireAction(tool.action, `tool ${tool.id}`)
    const inputSchema = ensureSafeRelativePath(tool.inputSchema, `tool ${tool.id} inputSchema`)
    const outputSchema = tool.outputSchema
      ? ensureSafeRelativePath(tool.outputSchema, `tool ${tool.id} outputSchema`)
      : undefined
    if (action.inputSchema !== inputSchema || (outputSchema && action.outputSchema !== outputSchema)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `tool ${tool.id} schemas must match its Backend action`)
    }
    return {
      id: tool.id,
      title: tool.title.trim(),
      description: tool.description.trim(),
      action: tool.action,
      inputSchema,
      ...(outputSchema ? { outputSchema } : {}),
      effect: tool.effect,
      ...normalizeContributionPermission(tool, requestedPermissions, `tool ${tool.id}`),
    }
  }, contributionIds)
  const schemes = new Set()
  const resourceProviders = normalizeContributionList(contributes.resourceProviders, 'resource provider', (provider) => {
    for (const scheme of provider.schemes) {
      if (schemes.has(scheme)) {
        throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate resource scheme in App: ${scheme}`)
      }
      schemes.add(scheme)
    }
    return {
      id: provider.id,
      schemes: [...provider.schemes],
      resolveAction: requireAction(provider.resolveAction, `resource provider ${provider.id}`).name,
      ...normalizeContributionPermission(provider, requestedPermissions, `resource provider ${provider.id}`),
    }
  }, contributionIds)
  const widgets = normalizeContributionList(contributes.widgets, 'widget', (widget) => {
    if (!viewIds.has(widget.viewId)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `widget ${widget.id} references unknown view: ${widget.viewId}`)
    }
    return {
      id: widget.id,
      title: widget.title.trim(),
      viewId: widget.viewId,
      placement: widget.placement,
      ...normalizeContributionPermission(widget, requestedPermissions, `widget ${widget.id}`),
    }
  }, contributionIds)
  const normalized = { views, settings, commands, tools, resourceProviders, widgets }
  return Object.values(normalized).some((items) => items.length) ? normalized : undefined
}

function normalizeBackend(backend) {
  if (!backend) return undefined
  const actionNames = new Set()
  const actions = backend.actions.map((action) => {
    if (actionNames.has(action.name)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Duplicate Backend action: ${action.name}`)
    }
    actionNames.add(action.name)
    return {
      name: action.name,
      ...(action.inputSchema ? { inputSchema: ensureSafeRelativePath(action.inputSchema, `action ${action.name} inputSchema`) } : {}),
      ...(action.outputSchema ? { outputSchema: ensureSafeRelativePath(action.outputSchema, `action ${action.name} outputSchema`) } : {}),
      ...(action.timeoutMs ? { timeoutMs: action.timeoutMs } : {}),
    }
  })
  return {
    entry: ensureSafeRelativePath(backend.entry, 'backend.entry'),
    runtime: 'node',
    apiVersion: 1,
    lifecycle: backend.lifecycle,
    instanceMode: backend.instanceMode,
    ...(backend.protocols?.length ? { protocols: [...backend.protocols] } : {}),
    actions,
    ...(backend.configuration ? {
      configuration: {
        ...(backend.configuration.schema ? { schema: ensureSafeRelativePath(backend.configuration.schema, 'backend.configuration.schema') } : {}),
        ...(backend.configuration.secrets ? { secrets: ensureSafeRelativePath(backend.configuration.secrets, 'backend.configuration.secrets') } : {}),
      },
    } : {}),
  }
}

export function validateAppManifest(rawManifest, options = {}) {
  const candidate = structuredClone(rawManifest)
  if (!validateManifestSchema(candidate)) {
    throw new AppServiceError(
      APP_ERROR_CODES.invalidManifest,
      `Invalid app.moss.json: ${formatAjvErrors(validateManifestSchema.errors)}`,
      validateManifestSchema.errors,
    )
  }
  if (!semver.valid(candidate.version)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Invalid semantic version: ${candidate.version}`)
  }
  if (!candidate.displayName.trim()) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'displayName cannot contain only whitespace')
  }
  if (candidate.publisher && !candidate.publisher.name.trim()) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, 'publisher.name cannot contain only whitespace')
  }
  if (!semver.validRange(candidate.hostApi)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Invalid hostApi range: ${candidate.hostApi}`)
  }
  const hostApiVersion = options.hostApiVersion || APP_HOST_API_VERSION
  if (!semver.satisfies(hostApiVersion, candidate.hostApi)) {
    throw new AppServiceError(
      APP_ERROR_CODES.incompatibleHost,
      `App requires Host API ${candidate.hostApi}; this Host provides ${hostApiVersion}`,
    )
  }
  const contributes = normalizeContributes(candidate.contributes, candidate)
  return {
    schemaVersion: 2,
    id: candidate.id,
    version: candidate.version,
    displayName: candidate.displayName.trim(),
    description: String(candidate.description || '').trim(),
    icon: candidate.icon ? ensureSafeRelativePath(candidate.icon, 'icon') : '',
    hostApi: candidate.hostApi,
    ...(candidate.publisher ? { publisher: { id: candidate.publisher.id, name: candidate.publisher.name.trim() } } : {}),
    ...(candidate.ui ? { ui: normalizeUi(candidate.ui) } : {}),
    ...(candidate.backend ? { backend: normalizeBackend(candidate.backend) } : {}),
    ...(contributes ? { contributes } : {}),
    permissions: [...candidate.permissions],
  }
}

export function loadJsonSchema(packageRoot, relativePath, fieldName = 'schema') {
  const safePath = ensureSafeRelativePath(relativePath, fieldName)
  const absolutePath = path.resolve(packageRoot, safePath)
  const relative = path.relative(path.resolve(packageRoot), absolutePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `${fieldName} escapes the App package`)
  }
  let schema
  try {
    schema = JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
    new Ajv2020({ strict: false }).compile(schema)
  } catch (error) {
    throw new AppServiceError(APP_ERROR_CODES.invalidManifest, `Invalid ${fieldName}: ${error.message}`)
  }
  return schema
}

export function compileJsonSchema(schema) {
  return new Ajv2020({ allErrors: true, strict: false }).compile(schema || {})
}
