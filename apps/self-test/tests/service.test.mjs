import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTestCatalog, selectTestCases, materializeTestCases, validateTestCatalog } from "../src/backend/catalog.mjs";
import { createSelfTestService, suiteTimeoutMs } from "../src/backend/service.mjs";
import { renderSelfTestReport } from "../src/backend/report.mjs";
const catalogDirectory = fileURLToPath(new URL("../resources/self-tests", import.meta.url));
const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function temporary() {
  const root = await mkdtemp(path.join(tmpdir(), "moss-self-test-unit-"));
  roots.push(root);
  return root;
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function fixture(options = {}) {
  const directory = await temporary(), entered = deferred(), finish = deferred(), exit = deferred();
  const calls = [];
  let createdRun;
  const service = createSelfTestService({
    directory,
    catalogDirectory,
    appVersion: "test",
    getSettings: () => ({ model: "test-model", apiKey: "private-value" }),
    prepareBrowser: async () => ({ version: "test", config: () => ({ type: "stdio", command: "node", args: ["mcp", "--cdp-endpoint", "test"] }) }),
    launchInstance: async () => ({ endpoint: "http://127.0.0.1:12345", exited: exit.promise, close: async () => {
      calls.push("close");
    } }),
    createController: async (run) => {
      createdRun = run;
      calls.push("create");
      return "controller";
    },
    executeController: async (_id, prompt) => {
      expect(prompt).toContain("moss_test_browser");
      entered.resolve();
      await finish.promise;
    },
    interruptController: () => {
      finish.resolve();
    },
    stopController: async () => {
      calls.push("stop");
    },
    ...options
  });
  return { service, directory, calls, entered, finish, exit, run: () => createdRun };
}
describe("bundled test catalog", () => {
  test("expanded modules have traceable sources, bounded budgets and independently selectable cases", async () => {
    const catalog = await loadTestCatalog(catalogDirectory);
    expect(new Set(catalog.cases.map(test => test.group)).size).toBe(10);
    for (const item of catalog.cases) {
      expect(item.sources.length).toBeGreaterThan(0);
      expect(item.timeoutSeconds).toBeGreaterThanOrEqual(30);
      expect(selectTestCases(catalog, [item.id])).toEqual([item]);
    }
    expect(suiteTimeoutMs(catalog.cases)).toBeGreaterThan(45 * 60_000);
    expect(suiteTimeoutMs(selectTestCases(catalog, ['startup']))).toBe(45 * 60_000);
    for (const field of [{ group: '' }, { sources: ['../settings.json'] }, { timeoutSeconds: -1 }, { timeoutSeconds: 180.5 }]) {
      expect(() => validateTestCatalog({ version: 1, cases: [{ ...catalog.cases[0], ...field }] })).toThrow();
    }
    const fixtures = JSON.parse(await readFile(new URL('../resources/fixtures.json', import.meta.url), 'utf8')).fixtures;
    expect(new Set(fixtures.map(file => file.name)).size).toBe(fixtures.length);
    expect(fixtures.length).toBeLessThanOrEqual(20); // Host testing contract
    for (const file of fixtures) {
      expect(file.name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
      expect(file.content.length).toBeLessThanOrEqual(65536);
    }
    const pdf = fixtures.find(file => file.name.endsWith('.pdf')).content;
    const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
    expect(pdf.slice(xref, xref + 4)).toBe('xref');
  });
  test("gives retained demo data a different visible identifier each run", async () => {
    const catalog = await loadTestCatalog(catalogDirectory);
    const first = materializeTestCases(catalog.cases, "11111111-1111-1111-1111-111111111111");
    const second = materializeTestCases(catalog.cases, "22222222-2222-2222-2222-222222222222");
    for (const id of ["session-switch", "chat-response", "workflow-demo", "agent-team-demo"]) {
      expect(first.find((test) => test.id === id).steps.join(" ")).toContain("11111111");
      expect(second.find((test) => test.id === id).steps.join(" ")).toContain("22222222");
    }
    expect(JSON.stringify(catalog.cases)).toContain("{{runShortId}}");
    expect(JSON.stringify(first)).not.toContain("{{runShortId}}");
  });
  test("loads from copied package resources without access to the repository", async () => {
    const root = await temporary();
    const destination = path.join(root, "self-tests");
    await cp(catalogDirectory, destination, { recursive: true });
    expect(await loadTestCatalog(destination)).toEqual(await loadTestCatalog(catalogDirectory));
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.name).toBe("@moss/self-test-app");
  });
  test("loads defaults, honors explicit selection and rejects corrupt IDs", async () => {
    const catalog = await loadTestCatalog(catalogDirectory);
    expect(catalog.cases).toHaveLength(59);
    expect(selectTestCases(catalog, undefined)).toHaveLength(30);
    expect(selectTestCases(catalog, undefined).some((test) => test.id === "preview-pdf")).toBe(false);
    expect(selectTestCases(catalog, undefined).filter((test) => test.requiresModel).map((test) => test.id)).toEqual(["session-switch", "chat-response"]);
    expect(selectTestCases(catalog, ["chat-response"])[0].requiresModel).toBe(true);
    expect(() => selectTestCases(catalog, ["startup", "startup"])).toThrow();
    expect(() => selectTestCases(catalog, ["unknown"])).toThrow();
    expect(() => validateTestCatalog({ version: 1, cases: [catalog.cases[0], catalog.cases[0]] })).toThrow();
    expect(() => validateTestCatalog({ version: 1, cases: [{ ...catalog.cases[0], expected: [] }] })).toThrow();
  });
});
describe("independent test lifecycle and reports", () => {
  test("a missing installed App manifest falls back to AI inspection without dropping other cases", async () => {
    const visited = [];
    const f = await fixture({
      launchInstance: async ({ run }) => {
        run.inheritedApps = [{ id: "moss.missing", version: "1.0.0", enabled: true }];
        return { endpoint: "http://127.0.0.1:12345", exited: new Promise(() => {}) };
      },
      executeController: async () => {
        const run = f.run();
        visited.push(run.activeCaseId);
        await f.service.record({ run_id: run.id, case_id: run.activeCaseId, status: "blocked", notes: "已检查前置条件。" }, "controller");
      },
    });
    await f.service.start(["startup", "apps-list", "chat-response"]);
    await f.service.waitForIdle();
    expect(visited).toEqual(["startup", "chat-response", "apps-list"]);
    expect(f.run().scripts["apps-list"]).toBeUndefined();
    expect(await readFile(f.run().scripts.startup, "utf8")).toContain("新会话");
    expect(await readFile(f.run().scripts["chat-response"], "utf8")).toContain("MOSS_SELF_TEST_OK");
  });
  test("advances after a submitted result even when the controller keeps its turn running", async () => {
    const visited = [];
    let release = () => {};
    const f = await fixture({
      recordGraceMs: 10,
      interruptController: () => release(),
      executeController: async () => {
        const run = f.run(), id = run.activeCaseId;
        visited.push(id);
        const finished = new Promise((resolve) => {
          release = resolve;
        });
        await f.service.record({ run_id: run.id, case_id: id, status: "blocked", notes: "前置条件缺失，已完成检查。" }, "controller");
        await finished;
      }
    });
    await f.service.start(["startup", "appearance"]);
    await f.service.waitForIdle();
    expect(visited).toEqual(["startup", "appearance"]);
    expect((await f.service.getStatus()).results.appearance.notes).toBe("前置条件缺失，已完成检查。");
    expect(f.calls).not.toContain("close");
  });
  test("continues after controller failures and preserves observations recorded before an error", async () => {
    const visited = [];
    const f = await fixture({ executeController: async (_id, _prompt) => {
      const run = f.run(), id = run.activeCaseId;
      visited.push(id);
      if (id === "startup")
        throw new Error("API 503 overloaded");
      await f.service.record({
        action: "record",
        run_id: run.id,
        case_id: id,
        status: "failed",
        checks: [{ index: 0, passed: false, actual: "主题切换后未生效" }],
        notes: "已复现外观问题。"
      }, "controller");
      throw new Error("Model stream interrupted after recording");
    } });
    await f.service.start(["startup", "appearance"]);
    await f.service.waitForIdle();
    const status = await f.service.getStatus();
    expect(visited).toEqual(["startup", "appearance"]);
    expect(status.results.startup).toMatchObject({ status: "blocked", checks: [] });
    expect(status.results.appearance).toMatchObject({ status: "failed", checks: [{ index: 0, passed: false, actual: "主题切换后未生效" }] });
    expect(status.results.appearance.notes).toContain("已复现外观问题");
    expect(status.activeCaseId).toBeNull();
  });
  test("publishes preparation stages and real copy counts while the target is starting", async () => {
    const updates = [];
    const f = await fixture({
      notify: (status) => updates.push(status),
      launchInstance: async ({ onProgress }) => {
        await onProgress({ stage: "apps", current: 1, total: 17, item: "moss.browser-use", label: "正在复制 App 2/17：moss.browser-use" });
        return { endpoint: "http://127.0.0.1:12345", exited: new Promise(() => {}), close: async () => {} };
      }
    });
    await f.service.start(["startup"]);
    await f.entered.promise;
    expect(updates.some((status) => status.phase === "starting" && status.preparation?.current === 1 && status.preparation?.total === 17 && status.message.includes("moss.browser-use"))).toBe(true);
    f.finish.resolve();
    await f.service.waitForIdle();
  });
  test("automatically opens the finished HTML while retaining the target and can reopen a historical report", async () => {
    const opened = [];
    const f = await fixture({ openReportWindow: async (file) => {
      expect(f.calls).not.toContain("close");
      expect(await readFile(file, "utf8")).toContain("问题与阻塞");
      opened.push(file);
    } });
    await f.service.start(["startup"]);
    await f.entered.promise;
    f.finish.resolve();
    await f.service.waitForIdle();
    expect(opened).toEqual([path.join(f.run().directory, "report.html")]);
    const historical = createSelfTestService({ directory: f.directory, openReportWindow: async (file) => {
      opened.push(file);
    } });
    await historical.openReport(f.run().id);
    expect(opened).toHaveLength(2);
  });
  test("Web runs save the report without a background preview prompt", async () => {
    const opened = [];
    const f = await fixture({ autoOpenReport: async () => false, openReportWindow: async file => opened.push(file) });
    await f.service.start(["startup"]);
    await f.entered.promise;
    f.finish.resolve();
    await f.service.waitForIdle();
    const status = await f.service.getStatus();
    expect(status.reportOpenError).toBeUndefined();
    expect(await readFile(status.reportHtmlPath, "utf8")).toContain("问题与阻塞");
    expect(opened).toEqual([]);
    await f.service.openReport(status.id);
    expect(opened).toEqual([status.reportHtmlPath]);
  });
  test("an open-window failure retains the saved report and reports the opening error", async () => {
    const f = await fixture({ openReportWindow: async () => {
      throw new Error("window failed");
    } });
    await f.service.start(["startup"]);
    await f.entered.promise;
    f.finish.resolve();
    await f.service.waitForIdle();
    const status = await f.service.getStatus();
    expect(status.reportOpenError).toBe("window failed");
    expect(await readFile(status.reportHtmlPath, "utf8")).toContain("未执行");
  });
  test("requires observed criteria and screenshot evidence, saves report and retains the target", async () => {
    const f = await fixture();
    const started = await f.service.start(["startup"]);
    await f.entered.promise;
    await expect(f.service.start()).rejects.toThrow("已有自测");
    await expect(f.service.handle({ action: "start" }, "controller")).rejects.toThrow("不能启动");
    const run = f.run();
    const checks = run.cases[0].expected.map((_, index) => ({ index, passed: true, actual: "已在真实界面观察" }));
    const record = { run_id: started.id, case_id: "startup", status: "passed", checks, evidence: ["startup.png"] };
    await expect(f.service.record(record, "other-session")).rejects.toThrow("只有本轮");
    await expect(f.service.record({ ...record, evidence: [] }, "controller")).rejects.toThrow("实际截图");
    await writeFile(path.join(run.evidenceDir, "startup.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    await expect(f.service.record({ ...record, checks: checks.slice(1) }, "controller")).rejects.toThrow("全部标准");
    const outside = path.join(f.directory, "outside.png");
    await writeFile(outside, "outside");
    await expect(f.service.record({ ...record, evidence: [outside] }, "controller")).rejects.toThrow("证据必须");
    await symlink(outside, path.join(run.evidenceDir, "linked.png"));
    await expect(f.service.record({ ...record, evidence: ["linked.png"] }, "controller")).rejects.toThrow("证据必须");
    const receipt = await f.service.record(record, "controller");
    expect(receipt).toMatchObject({ runId: started.id, caseId: "startup", status: "passed" });
    expect(JSON.stringify(receipt).length).toBeLessThan(240);
    expect(receipt).not.toHaveProperty("cases");
    f.finish.resolve();
    await f.service.waitForIdle();
    const status = await f.service.getStatus();
    expect(status.phase).toBe("completed");
    expect(status.results.startup.startedAt).toBeGreaterThanOrEqual(status.startedAt);
    expect(status.results.startup.recordedAt).toBeGreaterThanOrEqual(status.results.startup.startedAt);
    expect(status.results.startup.finishedAt).toBeGreaterThanOrEqual(status.results.startup.recordedAt);
    expect(status.results.startup.checks).toEqual(checks);
    expect(status.results.startup.evidence).toEqual(["startup.png"]);
    expect(status).toMatchObject({ model: "test-model", permissionMode: "bypassPermissions" });
    expect(f.calls).toEqual(["create", "stop"]);
    const saved = await readFile(status.reportPath, "utf8");
    expect(saved).not.toContain("private-value");
    expect(JSON.parse(saved).results.startup.status).toBe("passed");
    expect(await readFile(path.join(run.directory, "report.md"), "utf8")).toContain("已在真实界面观察");
    await expect(f.service.record(record, "controller")).rejects.toThrow("只有本轮");
  });
  test("unrecorded and blocked items cannot yield a passing run", async () => {
    const f = await fixture();
    await f.service.start(["startup", "appearance"]);
    await f.entered.promise;
    await f.service.record({ run_id: f.run().id, case_id: "startup", status: "blocked", notes: "没有可操作页面" }, "controller");
    f.finish.resolve();
    await f.service.waitForIdle();
    const status = await f.service.getStatus();
    expect(status.phase).toBe("failed");
    expect(status.results.appearance.status).toBe("blocked");
    expect(status.results.startup.status).toBe("blocked");
  });
  test("stop cancels a running controller and retains results", async () => {
    const f = await fixture();
    await f.service.start(["startup"]);
    await f.entered.promise;
    expect(f.service.stop().phase).toBe("stopping");
    await f.service.waitForIdle();
    expect((await f.service.getStatus()).phase).toBe("canceled");
    expect(f.calls).not.toContain("close");
  });
  test("startup failures are reportable and release the run lock", async () => {
    const f = await fixture({ launchInstance: async () => {
      throw new Error("CDP startup failed");
    } });
    await f.service.start(["startup"]);
    await f.service.waitForIdle();
    expect(await f.service.getStatus()).toMatchObject({ phase: "failed", message: "CDP startup failed" });
    expect(f.calls).toEqual([]);
    await f.service.start(["startup"]);
    await f.service.waitForIdle();
    expect(f.service.isRunning()).toBe(false);
  });
  test("stop during browser preparation does not wait for unrelated setup or launch a target", async () => {
    const preparing = deferred();
    const f = await fixture({ prepareBrowser: () => preparing.promise });
    await f.service.start(["startup"]);
    f.service.stop();
    await f.service.waitForIdle();
    expect((await f.service.getStatus()).phase).toBe("canceled");
    expect(f.calls).toEqual([]);
    preparing.resolve({ version: "late", config: () => ({}) });
  });
  test("target exit interrupts the controller and fails the run", async () => {
    const f = await fixture();
    await f.service.start(["startup"]);
    await f.entered.promise;
    f.exit.resolve();
    await f.service.waitForIdle();
    expect(await f.service.getStatus()).toMatchObject({ phase: "failed", message: "测试实例提前退出。" });
    expect(f.calls).toContain("stop");
  });
  test("stored active runs become interrupted after restarting the host", async () => {
    const f = await fixture();
    await f.service.start(["startup"]);
    await f.entered.promise;
    const reader = createSelfTestService({ directory: f.directory });
    expect((await reader.getStatus()).phase).toBe("interrupted");
    await expect(reader.getStatus("../report")).rejects.toThrow("ID 无效");
    f.finish.resolve();
    await f.service.waitForIdle();
  });
  test("target mode cannot recursively launch a new test", async () => {
    const f = await fixture({ isTarget: true });
    await expect(f.service.start()).rejects.toThrow("被测实例");
  });
});
describe("standalone HTML report", () => {
  test("embeds screenshot evidence, escapes model text and separates failures from blocked or unexecuted cases", async () => {
    const evidenceDir = await temporary();
    await writeFile(path.join(evidenceDir, "shot.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    const catalog = await loadTestCatalog(catalogDirectory);
    const html = await renderSelfTestReport({
      id: "report-test",
      startedAt: Date.now(),
      phase: "failed",
      evidenceDir,
      message: "<script>alert(1)</script>",
      model: "real-model",
      appVersion: "1",
      cases: selectTestCases(catalog, ["startup", "session-switch", "appearance"]),
      results: {
        startup: { status: "failed", notes: "<img src=x onerror=alert(1)>", checks: [], evidence: ["shot.png"] },
        "session-switch": { status: "blocked", notes: "模型不可用", checks: [] },
        appearance: { status: "pending" }
      }
    });
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain('data-status="blocked"');
    expect(html).toContain('data-status="pending"');
    expect(html).toContain("1 项未达预期");
  });
});
