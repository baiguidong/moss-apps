import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import JSZip from 'jszip';
import retrievalCases from './fixtures/library-retrieval-cases.json' with { type: 'json' };
import {
  buildLibraryFtsQuery,
  createLibraryService,
  evaluateLibraryRetrievalCases,
  parseLibraryResourceUri,
  parseLibraryDocumentWithPython,
  runLibraryRetrievalEvaluation,
  tokenizeLibraryText,
} from '../src/backend/store.mjs';

const cleanups = new WeakMap();
function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-library-'));
  const callbacks = [];
  cleanups.set(t, callbacks);
  t.after(async () => {
    for (const callback of callbacks.reverse()) await callback();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function parser() {
  return async (filePath) => {
    const content = await fsp.readFile(filePath, 'utf8');
    if (content.includes('PARSER_FAIL')) throw new Error('parser failed by fixture');
    return {
      title: path.basename(filePath, path.extname(filePath)),
      parser: 'fixture',
      blocks: [{ text: content, page: 2, heading: 'Fixture' }],
    };
  };
}

async function waitUntil(predicate, timeoutMs = 4_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Condition did not become true before timeout.');
}

test('Library field ranking and automatic broad fallback stay deterministic', async (t) => {
  const directory = temporaryDirectory(t);
  const corpus = path.join(directory, 'ranking');
  await fsp.mkdir(corpus);
  await Promise.all([
    fsp.writeFile(path.join(corpus, 'quarterly-plan.txt'), 'ordinary archive evidence'),
    fsp.writeFile(path.join(corpus, 'notes.txt'), 'quarterly appears only in the document body'),
    fsp.writeFile(path.join(corpus, 'broad.txt'), 'alpha beta record'),
  ]);
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  const source = await service.addLocalSource({ path: corpus });
  await service.waitForIdle();

  const titleResults = service.search({ sourceId: source.id, query: 'quarterly', mode: 'auto' });
  assert.equal(titleResults[0].title, 'quarterly-plan');
  assert.equal(titleResults[0].rank.matchedFields.includes('title'), true);
  assert.equal(titleResults[0].rank.exactPhrase, true);
  assert.equal(titleResults[0].rank.final, titleResults[0].score);

  assert.equal(service.search({ sourceId: source.id, query: 'alpha beta gamma', mode: 'all' }).length, 0);
  const broad = service.search({ sourceId: source.id, query: 'alpha beta gamma', mode: 'auto' });
  assert.equal(broad.length, 1);
  assert.equal(broad[0].title, 'broad');
  assert.equal(broad[0].rank.fallbackMode, 'any');
  assert.ok(broad[0].rank.queryCoverage >= 0.6);
});

test('Library expands bounded neighboring context and preserves citation ranges', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'context.md');
  const longText = [
    'BEGIN-CONTEXT',
    'before '.repeat(190),
    'middle retrieval needle',
    'after '.repeat(190),
    'END-CONTEXT',
  ].join('\n');
  await fsp.writeFile(sourcePath, longText);
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: async () => ({
      title: 'Context document',
      parser: 'fixture',
      blocks: [{ text: longText, heading: 'Context section', page: 3, startLine: 10 }],
    }),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  await service.addLocalSource({ path: sourcePath });
  await service.waitForIdle();

  const result = service.search({ query: 'retrieval needle', includeContext: true, limit: 1 })[0];
  assert.equal(result.matchedChunk, result.content);
  assert.ok(result.context.length > result.content.length);
  assert.ok(result.contextChunkIndexes.length >= 2);
  assert.match(result.context, /retrieval needle/);
  assert.equal(result.page, 3);
  assert.ok(result.startLine >= 10);
  assert.ok(result.endLine >= result.startLine);

});

test('Library context assembly keeps matches inside the total character budget', async (t) => {
  const directory = temporaryDirectory(t);
  const corpus = path.join(directory, 'budget');
  await fsp.mkdir(corpus);
  await Promise.all(Array.from({ length: 6 }, (_, index) => (
    fsp.writeFile(
      path.join(corpus, `document-${index}.txt`),
      `${'before '.repeat(220)} retrieval-budget-needle ${index} ${'after '.repeat(220)}`,
    )
  )));
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  await service.addLocalSource({ path: corpus });
  await service.waitForIdle();
  const results = service.search({
    query: 'retrieval-budget-needle',
    includeContext: true,
    contextBudget: 1_000,
    limit: 10,
  });
  assert.ok(results.length >= 5);
  assert.ok(results.every((entry) => entry.context.includes('retrieval-budget-needle')));
  assert.ok(results.reduce((sum, entry) => sum + entry.context.length, 0) <= 1_000);
});

test('Library diversifies top evidence across resources before adding another chunk', async (t) => {
  const directory = temporaryDirectory(t);
  const corpus = path.join(directory, 'diversity');
  await fsp.mkdir(corpus);
  await Promise.all([
    fsp.writeFile(path.join(corpus, 'many.txt'), 'many'),
    fsp.writeFile(path.join(corpus, 'single.txt'), 'single'),
  ]);
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: async (filePath) => ({
      title: path.basename(filePath, '.txt'),
      parser: 'fixture',
      blocks: path.basename(filePath) === 'many.txt'
        ? [
            { text: 'shared topic first', heading: 'One' },
            { text: 'shared topic second', heading: 'Two' },
            { text: 'shared topic third', heading: 'Three' },
          ]
        : [{ text: 'shared topic from another file', heading: 'Only' }],
    }),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  await service.addLocalSource({ path: corpus });
  await service.waitForIdle();

  const results = service.search({ query: 'shared topic', limit: 2 });
  assert.equal(results.length, 2);
  assert.equal(new Set(results.map((result) => result.resourceId)).size, 2);
});

test('Library reuses a bounded parse cache across sources and bypasses it for a full rebuild', async (t) => {
  const directory = temporaryDirectory(t);
  const firstPath = path.join(directory, 'first-cache.md');
  const secondPath = path.join(directory, 'second-cache.md');
  await Promise.all([
    fsp.writeFile(firstPath, '# Shared cache\n\nReusable parser output.'),
    fsp.writeFile(secondPath, '# Shared cache\n\nReusable parser output.'),
  ]);
  let parseCount = 0;
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parserCacheVersion: 'fixture-v1',
    parseDocument: async (filePath) => {
      parseCount += 1;
      return parser()(filePath);
    },
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  const firstSource = await service.addLocalSource({ path: firstPath });
  await service.waitForIdle();
  const secondSource = await service.addLocalSource({ path: secondPath });
  await service.waitForIdle();

  assert.equal(parseCount, 1);
  assert.equal(service.listResources().length, 2);
  assert.equal(service.search({ query: 'Reusable' }).length, 2);
  assert.equal(service.getMetrics().parseCache.entries, 1);
  assert.equal(service.getMetrics().parseCache.hits, 1);
  assert.equal(service.getMetrics().operations.some((entry) => entry.kind === 'parse-cache-hit'), true);

  service.refreshSource({ sourceId: secondSource.id, full: true });
  await service.waitForIdle();
  assert.equal(parseCount, 2);
  service.removeSource({ sourceId: firstSource.id });
  assert.equal(service.getMetrics().parseCache.entries, 1);
  service.removeSource({ sourceId: secondSource.id });
  assert.equal(service.getMetrics().parseCache.entries, 0);
});

test('Library retrieval evaluation reports stable quality and latency metrics', async () => {
  assert.equal(retrievalCases.length, 4);
  const cases = retrievalCases.slice(0, 3).map((entry, index) => ({
    ...entry,
    expectedResourceIds: [String.fromCharCode(97 + index)],
  }));
  const resultSets = [
    [{ resourceId: 'a' }],
    [{ resourceId: 'x' }, { resourceId: 'b' }],
    [],
  ];
  assert.deepEqual(evaluateLibraryRetrievalCases(cases, resultSets, [2, 4, 8]), {
    cases: 3,
    positiveCases: 3,
    negativeCases: 0,
    hitAt1: 1 / 3,
    hitAt5: 2 / 3,
    mrr: 0.5,
    negativeAccuracy: 0,
    noResultRate: 1 / 3,
    latencyP50Ms: 4,
    latencyP95Ms: 8,
  });
  const measured = await runLibraryRetrievalEvaluation(cases.slice(0, 2), async (entry) => (
    entry.expectedResourceIds[0] === 'a' ? resultSets[0] : resultSets[1]
  ));
  assert.equal(measured.cases, 2);
  assert.equal(measured.hitAt5, 1);
  assert.ok(measured.latencyP50Ms >= 0);

  const negative = evaluateLibraryRetrievalCases(
    [{ expectedResourceIds: [] }, { expectedResourceIds: ['wanted'] }],
    [[], [{ resourceId: 'wanted' }]],
    [1, 2],
  );
  assert.equal(negative.hitAt1, 1);
  assert.equal(negative.negativeAccuracy, 1);
});

test('Library stores real-data evaluation cases and explains search decisions', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'evaluation.md');
  await fsp.writeFile(sourcePath, 'Customer renewal policy and approval evidence.');
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  const collection = service.listCollections()[0];
  await service.addLocalSource({ collectionId: collection.id, path: sourcePath });
  await service.waitForIdle();
  const resource = service.listResources({ collectionId: collection.id })[0];

  const diagnostic = service.diagnoseSearch({
    collectionId: collection.id,
    query: 'renewal policy',
    mode: 'auto',
  });
  assert.equal(diagnostic.items[0].resourceId, resource.id);
  assert.equal(diagnostic.diagnostics.reason, 'results');
  assert.ok(diagnostic.diagnostics.candidateCounts.all >= 1);
  assert.equal(diagnostic.diagnostics.candidates[0].selected, true);

  const positive = service.saveEvaluationCase({
    query: 'renewal policy',
    expectedResourceId: resource.id,
    collectionId: collection.id,
  });
  const negative = service.saveEvaluationCase({
    query: 'term that cannot exist',
    expectedResourceId: null,
    collectionId: collection.id,
  });
  assert.equal(service.getEvaluationOverview().cases.length, 2);
  const run = service.runEvaluation();
  assert.equal(run.summary.cases, 2);
  assert.equal(run.summary.passedCases, 2);
  assert.equal(run.summary.hitAt1, 1);
  assert.equal(run.summary.negativeAccuracy, 1);
  assert.equal(service.getEvaluationOverview().latestRun.id, run.id);
  assert.equal(service.deleteEvaluationCase({ id: positive.id }).ok, true);
  assert.equal(service.deleteEvaluationCase({ id: negative.id }).ok, true);
  assert.equal(service.getEvaluationOverview().cases.length, 0);
});

test('Library treats SQL LIKE wildcard characters as literal fallback text', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'literal.txt');
  await fsp.writeFile(sourcePath, 'One hundred percent written without the symbol.');
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  await service.addLocalSource({ path: sourcePath });
  await service.waitForIdle();
  assert.equal(service.search({ query: '%' }).length, 0);
  assert.equal(service.diagnoseSearch({ query: '%' }).diagnostics.reason, 'no-indexable-terms');
});

test('Library preserves a local resource id across a content-identical rename', async (t) => {
  const directory = temporaryDirectory(t);
  const firstPath = path.join(directory, 'first.txt');
  const secondPath = path.join(directory, 'renamed.txt');
  await fsp.writeFile(firstPath, 'stable identity');
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });

  const source = await service.addLocalSource({ path: directory });
  await service.waitForIdle();
  const before = service.listResources({ sourceId: source.id })[0];
  await fsp.rename(firstPath, secondPath);
  service.refreshSource({ sourceId: source.id });
  await service.waitForIdle();
  const after = service.listResources({ sourceId: source.id });
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before.id);
  assert.equal(after[0].displayPath, 'renamed.txt');
});

test('Library rejects a resource replaced by a symlink outside its registered source', async (t) => {
  const directory = temporaryDirectory(t);
  const corpus = path.join(directory, 'corpus');
  const outside = path.join(directory, 'outside.txt');
  const sourcePath = path.join(corpus, 'inside.txt');
  await fsp.mkdir(corpus);
  await fsp.writeFile(sourcePath, 'authorized content');
  await fsp.writeFile(outside, 'outside secret');
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  const source = await service.addLocalSource({ path: corpus });
  await service.waitForIdle();
  const resource = service.listResources({ sourceId: source.id })[0];
  await fsp.rm(sourcePath);
  try {
    await fsp.symlink(outside, sourcePath);
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
      t.skip('Symbolic link creation is unavailable on this Windows host.');
      return;
    }
    throw error;
  }
  await assert.rejects(
    service.openResource({ resourceId: resource.id }),
    /符号链接/,
  );
});

test('Library skips unsupported and oversized files instead of cataloging them', async (t) => {
  const directory = temporaryDirectory(t);
  const corpus = path.join(directory, 'catalog');
  await fsp.mkdir(corpus);
  await fsp.writeFile(path.join(corpus, 'small.txt'), 'ok');
  await fsp.writeFile(path.join(corpus, 'large.txt'), 'this content is larger than the configured limit');
  await fsp.writeFile(path.join(corpus, 'archive.bin'), 'x');
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  const source = await service.addLocalSource({ path: corpus, maxFileBytes: 10 });
  await service.waitForIdle();
  const resources = service.listResources({ sourceId: source.id });
  assert.equal(resources.length, 1);
  assert.equal(resources[0].displayPath, 'small.txt');
  assert.equal(service.search({ sourceId: source.id, query: 'ok' }).length, 1);
  assert.equal(service.search({ sourceId: source.id, query: 'binary' }).length, 0);
});

test('Directory sources default to supported files within three nested levels', async (t) => {
  const directory = temporaryDirectory(t);
  const corpus = path.join(directory, 'bounded');
  await fsp.mkdir(path.join(corpus, 'one', 'two', 'three', 'four'), { recursive: true });
  await fsp.writeFile(path.join(corpus, 'root.txt'), 'root');
  await fsp.writeFile(path.join(corpus, 'photo.png'), 'not a supported document');
  await fsp.writeFile(path.join(corpus, 'one', 'one.md'), 'one');
  await fsp.writeFile(path.join(corpus, 'one', 'two', 'two.json'), '{"depth":2}');
  await fsp.writeFile(path.join(corpus, 'one', 'two', 'three', 'three.py'), 'depth = 3');
  await fsp.writeFile(path.join(corpus, 'one', 'two', 'three', 'four', 'four.txt'), 'too deep');
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });

  const source = await service.addLocalSource({ path: corpus });
  await service.waitForIdle();
  assert.equal(source.config.maxDepth, 3);
  assert.equal(source.config.maxFiles, 2_000);
  assert.ok(Array.isArray(source.config.extensions));
  assert.equal(source.config.extensions.includes('.png'), false);
  assert.deepEqual(
    service.listResources({ sourceId: source.id }).map((resource) => resource.displayPath).sort(),
    ['one/one.md', 'one/two/three/three.py', 'one/two/two.json', 'root.txt'],
  );
});

test('Directory sources keep one resource for files with identical content', async (t) => {
  const directory = temporaryDirectory(t);
  const corpus = path.join(directory, 'duplicates');
  const nested = path.join(corpus, 'nested');
  await fsp.mkdir(nested, { recursive: true });
  const canonicalPath = path.join(corpus, 'document.md');
  const duplicatePath = path.join(nested, 'copy.md');
  await fsp.writeFile(canonicalPath, 'identical document evidence');
  await fsp.copyFile(canonicalPath, duplicatePath);
  let parseCount = 0;
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: async (filePath) => {
      parseCount += 1;
      return parser()(filePath);
    },
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });

  const source = await service.addLocalSource({ path: corpus });
  await service.waitForIdle();
  assert.deepEqual(
    service.listResources({ sourceId: source.id }).map((resource) => resource.displayPath),
    ['document.md'],
  );
  assert.equal(service.listSources().find((entry) => entry.id === source.id).resourceCount, 1);
  assert.equal(parseCount, 1);
  assert.equal(service.search({ sourceId: source.id, query: 'identical' }).length, 1);

  await fsp.writeFile(duplicatePath, 'now a distinct document');
  service.refreshSource({ sourceId: source.id });
  await service.waitForIdle();
  assert.deepEqual(
    service.listResources({ sourceId: source.id }).map((resource) => resource.displayPath).sort(),
    ['document.md', 'nested/copy.md'],
  );
  assert.equal(service.listSources().find((entry) => entry.id === source.id).resourceCount, 2);
  assert.equal(parseCount, 2);
});

test('Removing an indexing source aborts work and leaves no indexed content', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'remove-while-indexing.txt');
  await fsp.writeFile(sourcePath, 'content that must not remain searchable');
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: async (_filePath, context = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ title: 'late', blocks: [{ text: 'late content' }] }), 10_000);
      context.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('cancelled');
        error.code = 'PARSER_CANCELLED';
        reject(error);
      }, { once: true });
    }),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  const collection = service.listCollections()[0];
  const source = await service.addLocalSource({ collectionId: collection.id, path: sourcePath });
  await waitUntil(() => service.listJobs({ sourceId: source.id })[0]?.status === 'running');

  assert.deepEqual(service.removeSource({ sourceId: source.id, collectionId: collection.id }), {
    ok: true,
    deleted: true,
    detached: false,
  });
  await service.waitForIdle();
  assert.equal(service.listSources().some((entry) => entry.id === source.id), false);
  assert.equal(service.listResources({ sourceId: source.id }).length, 0);
  assert.equal(service.search({ query: 'remain' }).length, 0);
  assert.equal(fs.existsSync(sourcePath), true);
});

test('A watched local source coalesces file changes into an incremental refresh', async (t) => {
  const directory = temporaryDirectory(t);
  const corpus = path.join(directory, 'watched');
  await fsp.mkdir(corpus);
  await fsp.writeFile(path.join(corpus, 'initial.txt'), 'initial content');
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
    watchSources: true,
    watchDebounceMs: 50,
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  await service.addLocalSource({ path: corpus });
  await service.waitForIdle();
  await fsp.writeFile(path.join(corpus, 'added.txt'), 'automatically refreshed evidence');
  await waitUntil(async () => {
    await service.waitForIdle();
    return service.search({ query: 'automatically' }).length === 1;
  });
  assert.equal(service.listResources().length, 2);
});

test('Cancelling a job terminates the active parser promptly', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'slow.txt');
  await fsp.writeFile(sourcePath, 'slow parser content');
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: async (_filePath, context = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ title: 'slow', blocks: [{ text: 'too late' }] }), 10_000);
      context.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('cancelled');
        error.code = 'PARSER_CANCELLED';
        reject(error);
      }, { once: true });
    }),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  const source = await service.addLocalSource({ path: sourcePath });
  await waitUntil(() => service.listJobs({ sourceId: source.id })[0]?.status === 'running');
  const job = service.listJobs({ sourceId: source.id })[0];
  const cancelledAt = Date.now();
  assert.equal(service.cancelJob({ jobId: job.id }).ok, true);
  await service.waitForIdle();
  assert.equal(service.listJobs({ sourceId: source.id })[0].status, 'cancelled');
  assert.ok(Date.now() - cancelledAt < 2_000);
  assert.equal(service.listResources({ sourceId: source.id })[0].status, 'discovered');
});

test('The bundled parser uses the versioned worker protocol', async (t) => {
  const directory = temporaryDirectory(t);
  const documentPath = path.join(directory, 'protocol.md');
  await fsp.writeFile(documentPath, '# Protocol title\n\nStructured parser evidence.');
  const parserPath = fileURLToPath(new URL('../src/backend/library_parser.py', import.meta.url));
  assert.ok(parserPath);
  const parsed = await parseLibraryDocumentWithPython({ documentPath, filePath: documentPath, parserPath });
  assert.equal(parsed.title, 'Protocol title');
  assert.equal(parsed.parser, 'stdlib-markdown');
  assert.match(parsed.blocks[0].text, /Structured parser evidence/);
});

test('The bundled parser preserves built-in Markdown and Office structure', async (t) => {
  const directory = temporaryDirectory(t);
  const parserPath = fileURLToPath(new URL('../src/backend/library_parser.py', import.meta.url));
  assert.ok(parserPath);

  const markdownPath = path.join(directory, 'structure.md');
  await fsp.writeFile(markdownPath, [
    '# Product guide',
    '',
    'Overview content.',
    '',
    '## Installation',
    '',
    'Install details.',
  ].join('\n'));
  const markdown = await parseLibraryDocumentWithPython({ filePath: markdownPath, parserPath });
  assert.equal(markdown.parser, 'stdlib-markdown');
  assert.equal(markdown.title, 'Product guide');
  assert.equal(markdown.blocks[0].heading, 'Product guide');
  assert.equal(markdown.blocks[1].heading, 'Product guide > Installation');
  assert.equal(markdown.blocks[1].startLine, 7);

  const docx = new JSZip();
  docx.file('word/document.xml', [
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>',
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Customer report</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Report body evidence.</w:t></w:r></w:p>',
    '</w:body></w:document>',
  ].join(''));
  const docxPath = path.join(directory, 'structure.docx');
  await fsp.writeFile(docxPath, await docx.generateAsync({ type: 'nodebuffer' }));
  const document = await parseLibraryDocumentWithPython({ filePath: docxPath, parserPath });
  assert.equal(document.parser, 'stdlib-docx');
  assert.equal(document.title, 'Customer report');
  assert.equal(document.blocks[0].heading, 'Customer report');
  assert.equal(document.blocks[0].locationKind, 'paragraph');
  assert.equal(document.blocks[0].startLine, 1);
  assert.match(document.blocks[0].text, /Report body evidence/);

  const pptx = new JSZip();
  pptx.file('ppt/slides/slide1.xml', [
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ',
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
    '<p:sp><p:nvSpPr/><p:txBody><a:p><a:r><a:t>Revenue evidence</a:t></a:r></a:p></p:txBody></p:sp>',
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>',
    '<p:txBody><a:p><a:r><a:t>Quarterly review</a:t></a:r></a:p></p:txBody></p:sp>',
    '</p:sld>',
  ].join(''));
  const pptxPath = path.join(directory, 'structure.pptx');
  await fsp.writeFile(pptxPath, await pptx.generateAsync({ type: 'nodebuffer' }));
  const presentation = await parseLibraryDocumentWithPython({ filePath: pptxPath, parserPath });
  assert.equal(presentation.parser, 'stdlib-pptx');
  assert.equal(presentation.blocks[0].heading, 'Quarterly review');
  assert.equal(presentation.blocks[0].page, 1);
  assert.equal(presentation.blocks[0].locationKind, 'slide');

  const xlsx = new JSZip();
  xlsx.file('xl/workbook.xml', [
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ',
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheets><sheet name="Sales detail" sheetId="1" r:id="rId7"/></sheets></workbook>',
  ].join(''));
  xlsx.file('xl/_rels/workbook.xml.rels', [
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId7" Target="worksheets/sheet2.xml"/></Relationships>',
  ].join(''));
  xlsx.file('xl/sharedStrings.xml', [
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<si><t>Customer</t></si><si><t>Amount</t></si></sst>',
  ].join(''));
  xlsx.file('xl/worksheets/sheet1.xml', [
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    '<row><c t="inlineStr"><is><t>Decoy sheet</t></is></c></row>',
    '</sheetData></worksheet>',
  ].join(''));
  xlsx.file('xl/worksheets/sheet2.xml', [
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    '<row r="4"><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>',
    '</sheetData></worksheet>',
  ].join(''));
  const xlsxPath = path.join(directory, 'structure.xlsx');
  await fsp.writeFile(xlsxPath, await xlsx.generateAsync({ type: 'nodebuffer' }));
  const workbook = await parseLibraryDocumentWithPython({ filePath: xlsxPath, parserPath });
  assert.equal(workbook.parser, 'stdlib-xlsx');
  assert.equal(workbook.blocks[0].heading, 'Sales detail');
  assert.equal(workbook.blocks[0].locationKind, 'sheet');
  assert.equal(workbook.blocks[0].startLine, 4);
  assert.match(workbook.blocks[0].text, /Customer\tAmount/);
  assert.doesNotMatch(workbook.blocks[0].text, /Decoy sheet/);
});

test('Library does not refresh completed watched sources on startup or fallback polling', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'stable.md');
  const libraryRoot = path.join(directory, 'library');
  await fsp.writeFile(sourcePath, 'stable watched content');
  let parseCount = 0;
  const parseDocument = async (filePath) => {
    parseCount += 1;
    return parser()(filePath);
  };
  let service = createLibraryService({
    libraryRoot,
    parserPath: path.join(directory, 'unused.py'),
    parseDocument,
    watchSources: true,
    watchFallbackMs: 1_000,
  });
  const source = await service.addLocalSource({ path: sourcePath });
  await service.waitForIdle();
  assert.equal(parseCount, 1);
  const completedJobCount = service.listJobs({ sourceId: source.id }).length;
  service.close();

  service = createLibraryService({
    libraryRoot,
    parserPath: path.join(directory, 'unused.py'),
    parseDocument,
    watchSources: true,
    watchFallbackMs: 1_000,
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  await new Promise((resolve) => setTimeout(resolve, 1_150));
  await service.waitForIdle();
  assert.equal(parseCount, 1);
  assert.equal(service.listJobs({ sourceId: source.id }).length, completedJobCount);
  assert.equal(service.listSources()[0].status, 'ready');
});

test('Library watcher does not retry an unchanged failed resource', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'failed.md');
  await fsp.writeFile(sourcePath, 'PARSER_FAIL unchanged failure');
  let parseCount = 0;
  const service = createLibraryService({
    libraryRoot: path.join(directory, 'library'),
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: async (filePath) => {
      parseCount += 1;
      return parser()(filePath);
    },
    watchSources: true,
    watchDebounceMs: 50,
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  const source = await service.addLocalSource({ path: sourcePath });
  await service.waitForIdle();
  assert.equal(parseCount, 1);
  assert.equal(service.listResources({ sourceId: source.id })[0].status, 'failed');
  assert.equal(service.listJobs({ sourceId: source.id })[0].error, '1 个资源索引失败。');
  assert.equal(service.listSources().find((entry) => entry.id === source.id).errorCount, 1);

  const nextTime = new Date(Date.now() + 2_000);
  await fsp.utimes(sourcePath, nextTime, nextTime);
  await waitUntil(() => service.listJobs({ sourceId: source.id }).length > 1);
  await service.waitForIdle();
  assert.equal(parseCount, 1);
  assert.equal(service.listResources({ sourceId: source.id })[0].status, 'failed');
  assert.match(service.listResources({ sourceId: source.id })[0].error, /parser failed/);

  service.refreshSource({ sourceId: source.id });
  await service.waitForIdle();
  assert.equal(parseCount, 2);
});

test('Library resumes an interrupted follow-up refresh without re-parsing unchanged content', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'completed.md');
  const libraryRoot = path.join(directory, 'library');
  await fsp.writeFile(sourcePath, 'already indexed evidence');
  let parseCount = 0;
  let service = createLibraryService({
    libraryRoot,
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: async (filePath) => {
      parseCount += 1;
      return parser()(filePath);
    },
  });
  const source = await service.addLocalSource({ path: sourcePath });
  await service.waitForIdle();
  service.close();

  const db = new DatabaseSync(path.join(libraryRoot, 'library.db'));
  db.prepare(`UPDATE library_sources SET status = 'indexing' WHERE id = ?`).run(source.id);
  db.prepare(`
    INSERT INTO library_jobs(id, source_id, kind, status, progress_json, created_at)
    VALUES ('follow-up-job', ?, 'refresh', 'running', '{"retryFailed":false}', ?)
  `).run(source.id, Date.now());
  db.close();

  service = createLibraryService({
    libraryRoot,
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: async (filePath) => {
      parseCount += 1;
      return parser()(filePath);
    },
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  await service.waitForIdle();
  const interrupted = service.listJobs({ sourceId: source.id })
    .find((job) => job.id === 'follow-up-job');
  assert.equal(interrupted.status, 'completed');
  assert.equal(interrupted.attemptCount, 1);
  assert.equal(parseCount, 1);
  assert.equal(service.listSources()[0].status, 'ready');
});

test('Library resumes an interrupted first index', async (t) => {
  const directory = temporaryDirectory(t);
  const sourcePath = path.join(directory, 'recovery.md');
  const libraryRoot = path.join(directory, 'library');
  await fsp.writeFile(sourcePath, 'recoverable evidence');
  let service = createLibraryService({
    libraryRoot,
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  const source = await service.addLocalSource({ path: sourcePath, refresh: false });
  service.close();

  const db = new DatabaseSync(path.join(libraryRoot, 'library.db'));
  db.prepare(`UPDATE library_sources SET status = 'indexing' WHERE id = ?`).run(source.id);
  db.prepare(`
    INSERT INTO library_jobs(id, source_id, kind, status, progress_json, created_at)
    VALUES ('interrupted-job', ?, 'refresh', 'running', '{}', ?)
  `).run(source.id, Date.now());
  db.close();

  service = createLibraryService({
    libraryRoot,
    parserPath: path.join(directory, 'unused.py'),
    parseDocument: parser(),
  });
  cleanups.get(t).push(async () => { service.close(); await service.waitForIdle(); });
  await service.waitForIdle();
  assert.equal(service.listJobs({ sourceId: source.id })[0].status, 'completed');
  assert.equal(service.listJobs({ sourceId: source.id })[0].attemptCount, 1);
  assert.equal(service.listSources()[0].status, 'ready');
  assert.equal(service.search({ query: 'recoverable' }).length, 1);
});
