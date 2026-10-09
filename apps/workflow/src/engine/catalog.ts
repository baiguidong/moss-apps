import { randomBytes } from 'crypto'
import { access, lstat, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { getOriginalCwd, getMossConfigHomeDir, findGitRoot } from '../storage/context.js'
import { lock } from 'proper-lockfile'
import {
  parseWorkflowDefinition,
  stringifyWorkflowDefinition,
  type WorkflowDefinitionV3,
} from './definition.js'
import { prepareWorkflowDefinition } from './runtime.js'
import { buildWorkflowGraph, type WorkflowGraph } from './graph.js'

export type WorkflowCatalogScope = 'user' | 'project'
export type WorkflowCatalogStatus = 'draft' | 'published' | 'archived'

export type WorkflowOrigin = {
  sessionId?: string
  toolUseId?: string
}

export type WorkflowCatalogRecord = {
  schemaVersion: 1
  id: string
  scope: WorkflowCatalogScope
  status: WorkflowCatalogStatus
  name: string
  title: string
  description: string
  currentRevision: number
  publishedRevision?: number
  publishedFileName?: string
  origin?: WorkflowOrigin
  createdAt: number
  updatedAt: number
  publishedAt?: number
}

export type WorkflowCatalogRevision = {
  schemaVersion: 1
  workflowId: string
  revision: number
  definition: WorkflowDefinitionV3
  graph: WorkflowGraph
  mermaid: string
  origin?: WorkflowOrigin
  changeSummary?: string
  createdAt: number
}

export type WorkflowCatalogEntry = WorkflowCatalogRecord & {
  graph: WorkflowGraph
  mermaid: string
  inputSchema?: unknown
}

export type WorkflowCatalogDetail = {
  record: WorkflowCatalogRecord
  revision: WorkflowCatalogRevision
  revisions: Array<Pick<WorkflowCatalogRevision, 'revision' | 'createdAt' | 'changeSummary' | 'origin'>>
}

const WORKFLOW_ID_PATTERN = /^wfd_[a-f0-9]{16}$/
const CATALOG_DIR = '.catalog'
const MANIFEST_FILE = 'manifest.json'
const LOCK_FILE = '.catalog.lock'

function catalogRoot(scope: WorkflowCatalogScope, cwd: string): string {
  if (scope === 'user') {
    return join(getMossConfigHomeDir(), 'workflows', CATALOG_DIR)
  }
  const root = findGitRoot(cwd) ?? resolve(cwd)
  return join(root, '.moss', 'workflows', CATALOG_DIR)
}

function workflowDir(root: string, workflowId: string): string {
  assertWorkflowId(workflowId)
  return join(root, workflowId)
}

function revisionPath(root: string, workflowId: string, revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(`Invalid workflow revision: ${revision}`)
  }
  return join(workflowDir(root, workflowId), `revision-${revision}.json`)
}

function publishedPath(root: string, fileName: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}\.workflow\.json$/.test(fileName)) {
    throw new Error(`Invalid published workflow file name: ${fileName}`)
  }
  return join(dirname(root), fileName)
}

async function assertCatalogWritePathSafe(
  root: string,
  scope: WorkflowCatalogScope,
): Promise<void> {
  if (scope !== 'project') return
  for (const candidate of [dirname(dirname(root)), dirname(root), root]) {
    try {
      if ((await lstat(candidate)).isSymbolicLink()) {
        throw new Error(`Refusing to write a workflow catalog through a symlink: ${candidate}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

function assertWorkflowId(workflowId: string): void {
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new Error(`Invalid workflow id: ${workflowId}`)
  }
}

function createWorkflowId(): string {
  return `wfd_${randomBytes(8).toString('hex')}`
}

function fileNameForDefinition(definition: WorkflowDefinitionV3): string {
  return `${definition.meta.name}.workflow.json`
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(tempPath, filePath)
  } catch (error) {
    await rollbackOrThrow(error, `Writing ${filePath}`, async () => {
      await unlinkIfExists(tempPath)
    })
  }
}

async function atomicWriteText(filePath: string, value: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tempPath, value, { encoding: 'utf8', mode: 0o600 })
    await rename(tempPath, filePath)
  } catch (error) {
    await rollbackOrThrow(error, `Writing ${filePath}`, async () => {
      await unlinkIfExists(tempPath)
    })
  }
}

async function unlinkIfExists(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function restoreTextFile(filePath: string, contents: string | undefined): Promise<void> {
  if (contents === undefined) {
    await unlinkIfExists(filePath)
    return
  }
  await atomicWriteText(filePath, contents)
}

async function rollbackOrThrow(
  operationError: unknown,
  description: string,
  rollback: () => Promise<void>,
): Promise<never> {
  try {
    await rollback()
  } catch (rollbackError) {
    throw new AggregateError(
      [operationError, rollbackError],
      `${description} failed and its rollback also failed`,
    )
  }
  throw operationError
}

async function withCatalogLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true })
  const lockPath = join(root, LOCK_FILE)
  try {
    await writeFile(lockPath, '', { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const release = await lock(lockPath, { retries: { retries: 8, minTimeout: 20, maxTimeout: 200 } })
  try {
    return await operation()
  } finally {
    await release()
  }
}

function prepareRevision(
  workflowId: string,
  revision: number,
  definitionInput: unknown,
  options: { origin?: WorkflowOrigin; changeSummary?: string; createdAt?: number } = {},
): WorkflowCatalogRevision {
  const parsed = parseWorkflowDefinition(definitionInput)
  if (!parsed.ok) throw new Error(parsed.error)
  const prepared = prepareWorkflowDefinition(parsed.definition)
  if (!prepared.ok) throw new Error(prepared.error)
  const graphResult = buildWorkflowGraph(parsed.definition)
  if ('error' in graphResult) throw new Error(graphResult.error)
  return {
    schemaVersion: 1,
    workflowId,
    revision,
    definition: parsed.definition,
    graph: graphResult.graph,
    mermaid: graphResult.mermaid,
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.changeSummary ? { changeSummary: options.changeSummary } : {}),
    createdAt: options.createdAt ?? Date.now(),
  }
}

function parseRecord(value: unknown): WorkflowCatalogRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid workflow manifest')
  const record = value as WorkflowCatalogRecord
  assertWorkflowId(record.id)
  if (record.schemaVersion !== 1 || !['user', 'project'].includes(record.scope)) {
    throw new Error('Unsupported workflow manifest')
  }
  if (!['draft', 'published', 'archived'].includes(record.status)) {
    throw new Error('Invalid workflow status')
  }
  return record
}

async function readRecord(root: string, workflowId: string): Promise<WorkflowCatalogRecord> {
  const source = await readFile(join(workflowDir(root, workflowId), MANIFEST_FILE), 'utf8')
  const record = parseRecord(JSON.parse(source))
  if (record.id !== workflowId) throw new Error(`Workflow manifest id mismatch: ${workflowId}`)
  return record
}

async function readRevision(
  root: string,
  workflowId: string,
  revision: number,
): Promise<WorkflowCatalogRevision> {
  const source = await readFile(revisionPath(root, workflowId, revision), 'utf8')
  const value = JSON.parse(source) as WorkflowCatalogRevision
  if (value.workflowId !== workflowId || value.revision !== revision) {
    throw new Error(`Workflow revision ${workflowId}@${revision} is corrupt`)
  }
  return prepareRevision(workflowId, revision, value.definition, {
    origin: value.origin,
    changeSummary: value.changeSummary,
    createdAt: value.createdAt,
  })
}

async function listRevisionSummaries(
  root: string,
  workflowId: string,
  currentRevision: number,
): Promise<WorkflowCatalogDetail['revisions']> {
  const names = await readdir(workflowDir(root, workflowId))
  const revisionNumbers = names
    .map(name => /^revision-(\d+)\.json$/.exec(name)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(value => Number(value))
    .filter(value => Number.isSafeInteger(value) && value > 0 && value <= currentRevision)
    .sort((left, right) => right - left)
  const revisions = await Promise.all(
    revisionNumbers.map(value => readRevision(root, workflowId, value)),
  )
  return revisions.map(revision => ({
    revision: revision.revision,
    createdAt: revision.createdAt,
    ...(revision.changeSummary ? { changeSummary: revision.changeSummary } : {}),
    ...(revision.origin ? { origin: revision.origin } : {}),
  }))
}

async function findCatalogRoot(
  workflowId: string,
  cwd: string,
): Promise<{ root: string; record: WorkflowCatalogRecord; scope: WorkflowCatalogScope }> {
  assertWorkflowId(workflowId)
  for (const scope of ['project', 'user'] as const) {
    const root = catalogRoot(scope, cwd)
    try {
      const record = await readRecord(root, workflowId)
      if (record.scope !== scope) {
        throw new Error(`Workflow manifest scope mismatch: ${workflowId}`)
      }
      return { root, record, scope }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }
  throw new Error(`Unknown workflow id: ${workflowId}`)
}

export async function createWorkflowDraft(input: {
  definition: unknown
  scope?: WorkflowCatalogScope
  cwd?: string
  origin?: WorkflowOrigin
  changeSummary?: string
}): Promise<WorkflowCatalogDetail> {
  const scope = input.scope ?? 'user'
  const cwd = input.cwd ?? getOriginalCwd()
  const root = catalogRoot(scope, cwd)
  await assertCatalogWritePathSafe(root, scope)
  return withCatalogLock(root, async () => {
    const id = createWorkflowId()
    const revision = prepareRevision(id, 1, input.definition, input)
    const now = revision.createdAt
    const record: WorkflowCatalogRecord = {
      schemaVersion: 1,
      id,
      scope,
      status: 'draft',
      name: revision.definition.meta.name,
      title: revision.definition.meta.title,
      description: revision.definition.meta.description,
      currentRevision: 1,
      ...(input.origin ? { origin: input.origin } : {}),
      createdAt: now,
      updatedAt: now,
    }
    await atomicWriteJson(revisionPath(root, id, 1), revision)
    await atomicWriteJson(join(workflowDir(root, id), MANIFEST_FILE), record)
    return { record, revision, revisions: [{
      revision: 1,
      createdAt: revision.createdAt,
      ...(revision.changeSummary ? { changeSummary: revision.changeSummary } : {}),
      ...(revision.origin ? { origin: revision.origin } : {}),
    }] }
  })
}

export async function updateWorkflowDraft(input: {
  workflowId: string
  baseRevision: number
  definition: unknown
  cwd?: string
  origin?: WorkflowOrigin
  changeSummary?: string
}): Promise<WorkflowCatalogDetail> {
  const cwd = input.cwd ?? getOriginalCwd()
  const located = await findCatalogRoot(input.workflowId, cwd)
  await assertCatalogWritePathSafe(located.root, located.scope)
  return withCatalogLock(located.root, async () => {
    const current = await readRecord(located.root, input.workflowId)
    if (current.currentRevision !== input.baseRevision) {
      throw new Error(
        `Workflow ${input.workflowId} changed from revision ${input.baseRevision} to ${current.currentRevision}; read it again before editing.`,
      )
    }
    if (current.status === 'archived') throw new Error('Archived workflows cannot be edited')
    const nextRevision = current.currentRevision + 1
    const revision = prepareRevision(input.workflowId, nextRevision, input.definition, input)
    const record: WorkflowCatalogRecord = {
      ...current,
      status: 'draft',
      name: revision.definition.meta.name,
      title: revision.definition.meta.title,
      description: revision.definition.meta.description,
      currentRevision: nextRevision,
      updatedAt: revision.createdAt,
    }
    await atomicWriteJson(revisionPath(located.root, input.workflowId, nextRevision), revision)
    await atomicWriteJson(join(workflowDir(located.root, input.workflowId), MANIFEST_FILE), record)
    return {
      record,
      revision,
      revisions: await listRevisionSummaries(located.root, input.workflowId, record.currentRevision),
    }
  })
}

export async function getWorkflowCatalogDetail(input: {
  workflowId: string
  revision?: number
  cwd?: string
}): Promise<WorkflowCatalogDetail> {
  const cwd = input.cwd ?? getOriginalCwd()
  const located = await findCatalogRoot(input.workflowId, cwd)
  const revisionNumber = input.revision ?? located.record.currentRevision
  if (revisionNumber > located.record.currentRevision) {
    throw new Error(
      `Workflow ${input.workflowId} only has committed revisions through ${located.record.currentRevision}.`,
    )
  }
  return {
    record: located.record,
    revision: await readRevision(located.root, input.workflowId, revisionNumber),
    revisions: await listRevisionSummaries(
      located.root,
      input.workflowId,
      located.record.currentRevision,
    ),
  }
}

export async function listWorkflowCatalog(input: {
  cwd?: string
  status?: WorkflowCatalogStatus
  publishedOnly?: boolean
} = {}): Promise<WorkflowCatalogEntry[]> {
  const cwd = input.cwd ?? getOriginalCwd()
  const entries: WorkflowCatalogEntry[] = []
  for (const scope of ['project', 'user'] as const) {
    const root = catalogRoot(scope, cwd)
    let names: string[]
    try {
      names = await readdir(root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const name of names) {
      if (!WORKFLOW_ID_PATTERN.test(name)) continue
      try {
        const record = await readRecord(root, name)
        if (record.scope !== scope) continue
        if (input.publishedOnly) {
          if (!record.publishedRevision || record.status === 'archived') continue
        } else if (input.status && record.status !== input.status) {
          continue
        }
        const revision = await readRevision(
          root,
          name,
          input.publishedOnly ? record.publishedRevision! : record.currentRevision,
        )
        entries.push({
          ...record,
          ...(input.publishedOnly ? {
            name: revision.definition.meta.name,
            title: revision.definition.meta.title,
            description: revision.definition.meta.description,
          } : {}),
          graph: revision.graph,
          mermaid: revision.mermaid,
          ...workflowInputSchema(revision.definition),
        })
      } catch {
        // One corrupt entry must not hide the rest of the catalog.
      }
    }
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt)
}

function workflowInputSchema(definition: WorkflowDefinitionV3): { inputSchema?: unknown } {
  const start = definition.graph.nodes.find(node => node.type === 'start')
  return start?.type === 'start' ? { inputSchema: start.outputSchema } : {}
}

export async function publishWorkflow(input: {
  workflowId: string
  cwd?: string
}): Promise<WorkflowCatalogDetail> {
  const cwd = input.cwd ?? getOriginalCwd()
  const located = await findCatalogRoot(input.workflowId, cwd)
  await assertCatalogWritePathSafe(located.root, located.scope)
  return withCatalogLock(located.root, async () => {
    const record = await readRecord(located.root, input.workflowId)
    if (record.status === 'archived') throw new Error('Archived workflows cannot be published')
    const revision = await readRevision(located.root, input.workflowId, record.currentRevision)
    const fileName = fileNameForDefinition(revision.definition)
    const targetPath = publishedPath(located.root, fileName)
    if (record.publishedFileName !== fileName) {
      try {
        await access(targetPath)
        throw new Error(
          `A saved workflow named '${revision.definition.meta.name}' already exists. Rename this draft before publishing.`,
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    const manifestPath = join(workflowDir(located.root, input.workflowId), MANIFEST_FILE)
    const previousTargetContents = await readTextIfExists(targetPath)
    const previousPublishedPath = record.publishedFileName
      ? publishedPath(located.root, record.publishedFileName)
      : undefined
    const now = Date.now()
    const published: WorkflowCatalogRecord = {
      ...record,
      status: 'published',
      publishedRevision: record.currentRevision,
      publishedFileName: fileName,
      publishedAt: now,
      updatedAt: now,
    }
    try {
      await atomicWriteText(targetPath, stringifyWorkflowDefinition(revision.definition))
      await atomicWriteJson(manifestPath, published)
      if (previousPublishedPath && previousPublishedPath !== targetPath) {
        await unlinkIfExists(previousPublishedPath)
      }
    } catch (error) {
      await rollbackOrThrow(error, `Publishing workflow ${input.workflowId}`, async () => {
        await atomicWriteJson(manifestPath, record)
        await restoreTextFile(targetPath, previousTargetContents)
      })
    }
    return {
      record: published,
      revision,
      revisions: await listRevisionSummaries(
        located.root,
        input.workflowId,
        published.currentRevision,
      ),
    }
  })
}

async function updateRecordWithoutPublication(
  root: string,
  workflowId: string,
  record: WorkflowCatalogRecord,
  status: 'draft' | 'archived',
): Promise<WorkflowCatalogDetail> {
  const manifestPath = join(workflowDir(root, workflowId), MANIFEST_FILE)
  const oldPublishedPath = record.publishedFileName
    ? publishedPath(root, record.publishedFileName)
    : undefined
  const oldPublishedContents = oldPublishedPath
    ? await readTextIfExists(oldPublishedPath)
    : undefined
  const updated: WorkflowCatalogRecord = {
    ...record,
    status,
    publishedRevision: undefined,
    publishedFileName: undefined,
    publishedAt: undefined,
    updatedAt: Date.now(),
  }
  try {
    if (oldPublishedPath) await unlinkIfExists(oldPublishedPath)
    await atomicWriteJson(manifestPath, updated)
  } catch (error) {
    await rollbackOrThrow(error, `${status === 'archived' ? 'Archiving' : 'Unpublishing'} workflow ${workflowId}`, async () => {
      if (oldPublishedPath && oldPublishedContents !== undefined) {
        await atomicWriteText(oldPublishedPath, oldPublishedContents)
      }
      await atomicWriteJson(manifestPath, record)
    })
  }
  return {
    record: updated,
    revision: await readRevision(root, workflowId, updated.currentRevision),
    revisions: await listRevisionSummaries(root, workflowId, updated.currentRevision),
  }
}

export async function unpublishWorkflow(input: {
  workflowId: string
  cwd?: string
}): Promise<WorkflowCatalogDetail> {
  const cwd = input.cwd ?? getOriginalCwd()
  const located = await findCatalogRoot(input.workflowId, cwd)
  await assertCatalogWritePathSafe(located.root, located.scope)
  return withCatalogLock(located.root, async () => {
    const record = await readRecord(located.root, input.workflowId)
    if (record.status === 'archived') {
      throw new Error('Archived workflows must be restored before they can be unpublished')
    }
    return updateRecordWithoutPublication(located.root, input.workflowId, record, 'draft')
  })
}

export async function archiveWorkflow(input: {
  workflowId: string
  cwd?: string
}): Promise<WorkflowCatalogDetail> {
  const cwd = input.cwd ?? getOriginalCwd()
  const located = await findCatalogRoot(input.workflowId, cwd)
  await assertCatalogWritePathSafe(located.root, located.scope)
  return withCatalogLock(located.root, async () => {
    const record = await readRecord(located.root, input.workflowId)
    return updateRecordWithoutPublication(located.root, input.workflowId, record, 'archived')
  })
}

export async function restoreWorkflow(input: {
  workflowId: string
  cwd?: string
}): Promise<WorkflowCatalogDetail> {
  const cwd = input.cwd ?? getOriginalCwd()
  const located = await findCatalogRoot(input.workflowId, cwd)
  await assertCatalogWritePathSafe(located.root, located.scope)
  return withCatalogLock(located.root, async () => {
    const record = await readRecord(located.root, input.workflowId)
    if (record.status !== 'archived') {
      throw new Error('Only archived workflows can be restored')
    }
    const updated: WorkflowCatalogRecord = {
      ...record,
      status: 'draft',
      updatedAt: Date.now(),
    }
    await atomicWriteJson(join(workflowDir(located.root, input.workflowId), MANIFEST_FILE), updated)
    return {
      record: updated,
      revision: await readRevision(located.root, input.workflowId, updated.currentRevision),
      revisions: await listRevisionSummaries(
        located.root,
        input.workflowId,
        updated.currentRevision,
      ),
    }
  })
}

export async function duplicateWorkflow(input: {
  workflowId: string
  name: string
  title?: string
  scope?: WorkflowCatalogScope
  cwd?: string
  origin?: WorkflowOrigin
}): Promise<WorkflowCatalogDetail> {
  const detail = await getWorkflowCatalogDetail(input)
  return createWorkflowDraft({
    definition: {
      ...detail.revision.definition,
      meta: {
        ...detail.revision.definition.meta,
        name: input.name,
        title: input.title ?? `${detail.revision.definition.meta.title.slice(0, 116)}（副本）`,
      },
    },
    scope: input.scope ?? detail.record.scope,
    cwd: input.cwd,
    origin: input.origin,
    changeSummary: `Duplicated from ${input.workflowId}@${detail.revision.revision}`,
  })
}

export async function deleteWorkflow(input: {
  workflowId: string
  cwd?: string
}): Promise<{ deleted: true; workflowId: string }> {
  const cwd = input.cwd ?? getOriginalCwd()
  const located = await findCatalogRoot(input.workflowId, cwd)
  await assertCatalogWritePathSafe(located.root, located.scope)
  return withCatalogLock(located.root, async () => {
    const record = await readRecord(located.root, input.workflowId)
    const oldPublishedPath = record.publishedFileName
      ? publishedPath(located.root, record.publishedFileName)
      : undefined
    const oldPublishedContents = oldPublishedPath
      ? await readTextIfExists(oldPublishedPath)
      : undefined
    try {
      if (oldPublishedPath) await unlinkIfExists(oldPublishedPath)
      await rm(workflowDir(located.root, input.workflowId), { recursive: true, force: true })
    } catch (error) {
      await rollbackOrThrow(error, `Deleting workflow ${input.workflowId}`, async () => {
        if (oldPublishedPath && oldPublishedContents !== undefined) {
          await atomicWriteText(oldPublishedPath, oldPublishedContents)
        }
      })
    }
    return { deleted: true, workflowId: input.workflowId }
  })
}
