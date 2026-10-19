import { test, expect } from 'bun:test';
import { createReviewQueue } from '../src/backend/review-queue.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('capacity counts active reviews and abort wakes a blocked producer', async () => {
  const started = deferred(), release = deferred(), abort = new AbortController();
  const queue = createReviewQueue({ signal: abort.signal, capacity: 2, batchSize: 1, batchWaitMs: 0,
    review: async () => { started.resolve(); await release.promise; } });
  await queue.push('first'); await started.promise; await queue.push('second');
  let advanced = false;
  const waiting = queue.ready().then(() => { advanced = true; }).catch(e => e.message);
  await new Promise(r => setTimeout(r, 5)); expect(advanced).toBe(false);
  abort.abort(new Error('stop')); expect(await waiting).toBe('stop'); release.resolve();
  await expect(queue.close()).rejects.toThrow('stop');
});
test('image count splits batches without dropping oversized evidence', async () => {
  const batches = [], abort = new AbortController();
  const queue = createReviewQueue({ signal: abort.signal, batchWaitMs: 100,
    weight: item => ({ images: item, bytes: 1 }), review: async batch => { batches.push(batch); } });
  await queue.push(6); await queue.push(6); await queue.push(12); await queue.close();
  expect(batches).toEqual([[6], [6], [12]]);
});

test('large compressed screenshots split by pixels without omitting images', async () => {
  const batches = [], abort = new AbortController();
  const queue = createReviewQueue({ signal: abort.signal, batchWaitMs: 100,
    weight: () => ({ images: 4, bytes: 400000, pixels: 2600000 }), review: async batch => { batches.push(batch); } });
  await queue.push('skills'); await queue.push('experts'); await queue.close();
  expect(batches).toEqual([['skills'], ['experts']]);
});
