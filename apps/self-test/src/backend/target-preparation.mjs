import { setTimeout as delay } from 'node:timers/promises';

export async function prepareTestTarget({ host, fixtures, resetData = true, signal, onProgress }) {
  const waitForOperation = async () => {
    for (;;) {
      signal.throwIfAborted();
      const state = await host('target.status', {}, signal);
      await onProgress(state.progress || { stage: 'launch', label: state.message });
      if (!state.operation) return state;
      await delay(250, undefined, { signal });
    }
  };
  try {
    // A user may have opened/synchronized the target just before pressing Start.
    // Finish that operation, then still reset; do not accidentally reuse its data.
    await waitForOperation();
    signal.throwIfAborted();
    await onProgress({ stage: resetData ? 'reset' : 'launch', label: resetData ? '正在清理上轮测试数据并重新打开测试窗口…' : '正在打开保留数据的测试窗口…' });
    await host(resetData ? 'target.reset' : 'target.open', fixtures, signal);
    const state = await waitForOperation();
    if (state.operationError) throw new Error(state.operationError);
    if (state.phase !== 'open') throw new Error('测试实例未打开。');
  } catch (error) {
    const state = await host('target.status').catch(() => null);
    if (state?.operation) await host('target.close').catch(() => {});
    throw error;
  }
}
