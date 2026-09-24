import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEnvelope } from "@moss/app-sdk";

const require = createRequire(import.meta.url);
const sdkPackage = require.resolve("@openim/node-client-sdk/package.json");
const sdkRequire = createRequire(sdkPackage);
const nativeFolder = `${process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux"}_${process.arch}`;
const nativeFile = process.platform === "darwin" ? "libopenimsdk.dylib" : process.platform === "win32" ? "libopenimsdk.dll" : "libopenimsdk.so";
const library = path.join(path.dirname(sdkPackage), "assets", nativeFolder, nativeFile);
let root: string;
let fixture: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "moss-openim-lifecycle-"));
  const entry = path.join(root, "fixture.ts");
  await fs.writeFile(entry, `
import { AppBackendClient } from ${JSON.stringify(fileURLToPath(import.meta.resolve("@moss/app-sdk")))};
import { installOpenIMShutdownHandlers } from ${JSON.stringify(fileURLToPath(new URL("./lifecycle.ts", import.meta.url)))};
import { createRequire } from 'node:module';
const shutdown = installOpenIMShutdownHandlers(async () => {
  console.log('cleanup');
  if (process.env.TEST_CLEANUP === 'hang') await new Promise(() => {});
  if (process.env.TEST_CLEANUP === 'reject') throw new Error('cleanup failed');
  await new Promise(resolve => setTimeout(resolve, 80));
}, 300);
// Loading the actual Go library is necessary to reproduce the signal loop.
createRequire(import.meta.url)(${JSON.stringify(sdkRequire.resolve("koffi"))}).load(${JSON.stringify(library)});
new AppBackendClient({ onShutdown: shutdown }).start();
setInterval(() => {}, 1000);
`);
  const result = await Bun.build({ entrypoints: [entry], outdir: root, target: "node" });
  if (!result.success) throw new Error(result.logs.join("\n"));
  fixture = result.outputs[0]!.path;
});

afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

async function withBackend(
  run: (child: ChildProcess, output: () => string) => Promise<void>,
  cleanup = "normal",
) {
  // Exercise Node rather than Bun: the bug involves Node's native signal handler.
  const child = spawn(process.env.MOSS_NODE_PATH || "node", [fixture], {
    env: { ...process.env, TEST_CLEANUP: cleanup },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout!.on("data", chunk => { output += String(chunk); });
  child.stderr!.on("data", chunk => { output += String(chunk); });
  const closed = once(child, "close");
  let deadline = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    const [hello] = await Promise.race([
      once(child, "message"),
      closed.then(() => { throw new Error(`Backend exited before hello: ${output}`); }),
    ]);
    expect(hello.type).toBe("service.hello");
    clearTimeout(deadline);
    deadline = setTimeout(() => child.kill("SIGKILL"), 2_000);
    await run(child, () => output);
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
  }
}

describe("OpenIM native Backend lifecycle", () => {
  // child.kill() forcibly terminates on Windows rather than delivering POSIX signals.
  const signalTest = process.platform === "win32" ? it.skip : it;
  signalTest.each(["SIGTERM", "SIGINT"] as const)("cleans up and exits on %s without a native signal loop", async signal => {
    await withBackend(async (child, output) => {
      const exited = once(child, "exit");
      child.kill(signal);
      expect(await exited).toEqual([0, null]);
      expect(output()).toContain("cleanup");
    });
  });

  signalTest("cleans up only once when shutdown and repeated signals overlap", async () => {
    await withBackend(async (child, output) => {
      const exited = once(child, "exit");
      const cleaning = once(child.stdout!, "data");
      child.send(createEnvelope("service.shutdown", {}));
      await cleaning;
      child.kill("SIGTERM");
      child.kill("SIGINT");
      expect(await exited).toEqual([0, null]);
      expect(output().match(/^cleanup$/gm)).toHaveLength(1);
    });
  });

  it("exits when the Host IPC connection closes", async () => {
    await withBackend(async child => {
      const exited = once(child, "exit");
      child.disconnect();
      expect(await exited).toEqual([0, null]);
    });
  });

  it("bounds cleanup even when the native SDK never finishes", async () => {
    await withBackend(async (child, output) => {
      const exited = once(child, "exit");
      child.send(createEnvelope("service.shutdown", {}));
      expect(await exited).toEqual([1, null]);
      expect(output()).toContain("shutdown timed out");
    }, "hang");
  });

  it("exits if cleanup fails while native handles are still alive", async () => {
    await withBackend(async (child, output) => {
      const exited = once(child, "exit");
      child.send(createEnvelope("service.shutdown", {}));
      expect(await exited).toEqual([1, null]);
      expect(output()).toContain("shutdown failed");
    }, "reject");
  });
});
