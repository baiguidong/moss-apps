/** A single reader of immutable evidence; never owns the browser. */
export function createReviewQueue({ review, signal, capacity = 6, batchSize = 3, batchWaitMs = 100,
  weight = () => ({ images: 0, bytes: 0 }), onError = () => {} }) {
  const queue = [], listeners = new Set();
  let active = 0, closed = false, flushing = false, failure;
  const notify = () => { for (const wake of [...listeners]) wake(); };
  const assertLive = () => { signal.throwIfAborted(); if (failure) throw failure; };
  const wait = milliseconds => new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { listeners.delete(wake); signal.removeEventListener('abort', abort); clearTimeout(timer); };
    const wake = () => { cleanup(); resolve(); };
    const abort = () => { cleanup(); reject(signal.reason); };
    listeners.add(wake); signal.addEventListener('abort', abort, { once: true });
    if (milliseconds !== undefined) timer = setTimeout(wake, milliseconds);
    if (signal.aborted) abort();
  });
  const work = (async () => {
    while (!closed || queue.length) {
      assertLive();
      if (!queue.length) { await wait(); continue; }
      const until = performance.now() + batchWaitMs;
      while (!closed && !flushing && queue.length < batchSize && performance.now() < until) {
        await wait(Math.max(1, until - performance.now())); assertLive();
      }
      const batch = []; let images = 0, bytes = 0, pixels = 0;
      while (queue.length && batch.length < batchSize) {
        const next = weight(queue[0]);
        // Never drop evidence to fit a batch. An oversized case travels alone.
        if (batch.length && (images + next.images > 10 || bytes + next.bytes > 8 * 1024 * 1024 || pixels + (next.pixels || 0) > 4_500_000)) break;
        batch.push(queue.shift()); images += next.images; bytes += next.bytes; pixels += next.pixels || 0;
      }
      active = batch.length; notify();
      try { await review(batch); } finally { active = 0; notify(); }
    }
  })().catch(error => { failure = error; onError(error); notify(); throw error; });
  void work.catch(() => {}); // The owner awaits close(), including after abort.
  return {
    async ready() { assertLive(); while (queue.length + active >= capacity) { await wait(); assertLive(); } },
    async push(item) { await this.ready(); if (closed) throw new Error('验收队列已关闭。'); queue.push(item); notify(); },
    async drain() {
      flushing = true; notify();
      try { while (queue.length || active) { await wait(); assertLive(); } assertLive(); }
      finally { flushing = false; }
    },
    close() { closed = true; notify(); return work; },
  };
}
