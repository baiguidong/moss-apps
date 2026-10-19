import { fork } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

export function createRecipeRunner(packageRoot) {
  return async (run, test, signal) => {
    signal.throwIfAborted();
    const script = await fs.realpath(run.scripts[test.id]);
    const root = await fs.realpath(path.join(run.directory, 'scripts'));
    if (path.dirname(script) !== root || path.basename(script) !== `${test.id}.js`) throw new Error('测试脚本路径无效。');
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = fork(path.join(packageRoot, 'dist/backend/recipe-worker.mjs'), [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [],
      });
      let response, failure;
      const stop = reason => { failure ||= reason; child.kill('SIGKILL'); };
      const abort = () => stop(signal.reason);
      const timer = setTimeout(() => stop(new Error(`页面检查超过 ${test.timeoutSeconds || 180} 秒，已停止。`)), (test.timeoutSeconds || 180) * 1000);
      signal.addEventListener('abort', abort, { once: true });
      child.once('error', error => { failure = error; });
      child.on('message', value => { response = value; });
      child.once('close', () => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (response?.result) resolve(response.result);
        else reject(new Error(response?.error || '页面检查进程未返回结果。'));
      });
      if (signal.aborted) abort();
      else child.send({ script, endpoint: run.endpoint, targetId: run.targetId, evidenceDir: run.evidenceDir,
        engine: path.join(packageRoot, 'dist/playwright-cdp/node_modules/playwright-core/index.mjs') });
    });
  };
}
