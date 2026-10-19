import { test, expect } from 'bun:test';
import { prepareTestTarget } from '../src/backend/target-preparation.mjs';

test('a new run resets even when an earlier manual open is still finishing', async () => {
  const calls = [], progress = [];
  const states = [{ operation: 'open' }, { phase: 'open' }, { operation: 'reset' }, { phase: 'open' }];
  await prepareTestTarget({ fixtures: { title: 'fixture' }, signal: new AbortController().signal,
    onProgress: state => progress.push(state),
    host: async (method, input) => { calls.push({ method, input }); return method === 'target.status' ? states.shift() : {}; },
  });
  expect(calls.map(call => call.method)).toEqual(['target.status', 'target.status', 'target.reset', 'target.status', 'target.status']);
  expect(calls[2].input).toEqual({ title: 'fixture' });
  expect(progress.some(state => state.stage === 'reset')).toBe(true);
});

test('retaining data is explicit, and a failed cleanup never continues to testing', async () => {
  const calls = [];
  await prepareTestTarget({ resetData: false, fixtures: {}, signal: new AbortController().signal, onProgress: () => {},
    host: async method => { calls.push(method); return { phase: 'open' }; },
  });
  expect(calls).toEqual(['target.status', 'target.open', 'target.status']);
  let reset = false;
  await expect(prepareTestTarget({ signal: new AbortController().signal, onProgress: () => {},
    host: async method => { if (method === 'target.reset') reset = true; return reset ? { phase: 'closed', operationError: 'cleanup failed' } : { phase: 'open' }; },
  })).rejects.toThrow('cleanup failed');
});

test('canceling preparation closes only the pending target operation', async () => {
  const controller = new AbortController(), calls = [];
  await expect(prepareTestTarget({ signal: controller.signal, onProgress: () => {}, host: async method => {
    calls.push(method);
    if (method === 'target.reset') controller.abort(new Error('stopped'));
    return { phase: 'starting', operation: method === 'target.status' && calls.length === 1 ? null : 'reset' };
  } })).rejects.toThrow('stopped');
  expect(calls.at(-1)).toBe('target.close');
});
