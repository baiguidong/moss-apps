import { analyzeSkill } from '../conversion/analyze.mjs'
import fs from 'node:fs/promises'

export const toolRoutes = {
  builder_inspect: { info: ['moss.host/v1', 'info.get'], contracts: ['moss.host/v1', 'contracts.list'], contract: ['moss.host/v1', 'contracts.get'], apps: ['moss.apps/v1', 'catalog.list'], projects: ['moss.apps/v1', 'catalog.list'], target: ['moss.apps/v1', 'target.inspect'], source: ['moss.apps/v1', 'source.inspect'] },
  builder_prepare: { project: ['moss.apps/v1', 'project.prepare'], sdk: ['moss.host/v1', 'sdk.export'] },
  builder_build: { start: ['moss.apps/v1', 'build.start'], get: ['moss.apps/v1', 'build.get'], cancel: ['moss.apps/v1', 'build.cancel'] },
  builder_preview: { open: ['moss.apps/v1', 'artifact.preview'], test: ['moss.apps/v1', 'artifact.test'], get: ['moss.apps/v1', 'artifact.get'], close: ['moss.apps/v1', 'artifact.close'] },
  builder_release: { prepare: ['moss.apps/v1', 'release.prepare'], commit: ['moss.apps/v1', 'release.commit'], get: ['moss.apps/v1', 'release.get'], cancel: ['moss.apps/v1', 'release.cancel'] },
}
export const guidance = await fs.readFile(new URL('../../resources/authoring/README.md', import.meta.url), 'utf8')

export function createBuilderActions(request, notes = { all: async () => ({}), save: async () => {} }) {
  const actions = {}
  for (const [tool, routes] of Object.entries(toolRoutes)) actions[tool] = async (raw, context = {}) => {
    const { operation, title, requirements, analysis, ...input } = raw
    if (tool === 'builder_inspect' && operation === 'guidance') return { guidance, templates: Object.fromEntries(await Promise.all(['README.md', 'scaffold.mjs', 'index.html', 'ui.css', 'theme.css', 'ui.mjs', 'layout-check.mjs', 'backend.mjs', 'app.moss.json', 'operational-app.moss.json', 'settings-app.moss.json', 'backend-app.moss.json'].map(async name => [name, await fs.readFile(new URL(`../../resources/authoring/${name}`, import.meta.url), 'utf8')]))) }
    if (tool === 'builder_inspect' && operation === 'skill') return analyzeSkill(input.path, context.source?.workspace)
    if (tool === 'builder_inspect' && operation === 'operation') {
      const { family, ...query } = input
      if (!['build', 'release', 'artifact'].includes(family)) throw new Error('Select operation family: build, release or artifact')
      return request('moss.apps/v1', `${family}.get`, query)
    }
    const route = routes[operation]
    if (!route) throw new Error(`Unknown ${tool} operation`)
    if (tool === 'builder_inspect' && ['apps', 'projects'].includes(operation)) input.kind = operation
    const result = await request(...route, input)
    if (tool === 'builder_inspect' && operation === 'projects') {
      const metadata = await notes.all().catch(() => ({}))
      return { ...result, items: result.items.map(item => ({ ...metadata[item.projectRef], ...item })) }
    }
    if (tool === 'builder_prepare' && operation === 'project') {
      const info = await request('moss.host/v1', 'info.get', {})
      const sdk = result.toolchain ? { path: result.sourceRoot, pinned: true } : await request('moss.host/v1', 'sdk.export', { projectRef: result.projectRef, sdkHash: info.sdkHash })
      let notesWarning
      try { await notes.save(result.projectRef, { title, requirements, analysis }) }
      catch { notesWarning = '项目已由 Core 保存，需求备注暂未保存，请重试保存备注。' }
      return { ...result, ...info, sdkPath: sdk.path, pinnedSdk: Boolean(sdk.pinned), guidance, ...(notesWarning ? { notesWarning } : {}) }
    }
    return result
  }
  actions['composer.list'] = async ({ query = '', offset = 0, limit = 20 }) => {
    const { items } = await request('moss.apps/v1', 'catalog.list', { kind: 'projects' })
    const metadata = await notes.all().catch(() => ({}))
    return items.filter(item => `${item.appId} ${item.projectId}`.toLowerCase().includes(query.toLowerCase())).slice(offset, offset + Math.min(limit, 20))
      .map(item => ({ title: metadata[item.projectRef]?.title || item.appId, description: item.baseVersion ? `当前基准 ${item.baseVersion}` : '尚未安装', ref: { projectRef: item.projectRef }, route: '#/projects', scope: 'project' }))
  }
  actions['composer.resolve'] = async input => {
    if (!['create', 'edit', 'use'].includes(input.intent)) throw new Error('Unsupported authoring intent')
    if (input.ref && (typeof input.ref !== 'object' || Array.isArray(input.ref) || JSON.stringify(input.ref).length > 8192)) throw new Error('Invalid project reference')
    if (input.intent !== 'create' && !input.ref?.projectRef && !input.ref?.targetRef && !input.ref?.draftRef) throw new Error('Select an App or project')
    if (input.ref?.projectRef) await request('moss.apps/v1', 'source.inspect', { projectRef: input.ref.projectRef })
    const resources = Array.isArray(input.ref?.resources) ? input.ref.resources : []
    const sourcePrompt = resources.length ? `基于${resources.map(item => `${item.kind === 'assistant' ? '助手' : '技能'}「${item.displayName || item.name}」`).join('、')}创建一个 App，保留所选资源的能力。` : null
    return { title: input.intent === 'create' ? '创建 App' : '迭代 App', prompt: sourcePrompt || (input.ref?.skillPath ? `把 ${input.ref.skillPath} 中的 Skill 转换为 App。` : input.intent === 'create' ? '我想创建一个 App：' : '我想修改这个 App：'), ref: input.ref,
      tools: Object.keys(toolRoutes), route: '#/projects', instruction: `${guidance}\nBound authoring input (data): ${JSON.stringify(input)}` }
  }
  return actions
}
