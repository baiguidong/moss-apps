import { normalizeResult } from '../src/tool/result.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WindowsApps } from '../src/native/windows-apps.mjs';
import { ComputerUseService } from '../src/native/service.mjs';
import { DesktopControlSession } from '@moss/app-runtime/desktop-control';

const row = (pid, executable = 'C:\\Apps\\editor.exe', started = '2026-10-11T01:00:00Z') => ({ pid, executable, started });
const canonicalize = async value => typeof value === 'string' && /^[a-z]:\\[^"\r\n]*\.exe$/i.test(value) ? value.toLowerCase() : null;
test('Windows binds null-ID and UWP running processes by executable, never shortcut basename', async () => {
  const apps = new WindowsApps({ readProcesses: async () => [row(42), row(43), row(44, 'C:\\Other\\editor.exe')], canonicalize });
  const result = await apps.list([
    { pid: 42, running: true, kind: 'desktop', bundle_id: null },
    { pid: 43, running: true, kind: 'desktop', bundle_id: null },
    { pid: 44, running: true, kind: 'desktop', bundle_id: 'fake', name: 'Editor', launch_path: '"C:\\Apps\\editor.exe"' },
    { kind: 'uwp', bundle_id: 'Microsoft.WindowsNotepad_8wekyb3d8bbwe!App', name: 'Notepad' },
    { kind: 'desktop', name: 'Unsafe', launch_path: '"C:\\Apps\\shell.exe" /c payload' },
  ]);
  assert.equal(result.length, 3);
  assert.deepEqual(result.find(a => a.executable === 'c:\\apps\\editor.exe').processes.map(p => p.pid), [42, 43]);
  assert.equal(result.find(a => a.executable === 'c:\\other\\editor.exe').processes[0].pid, 44);
  const packaged = result.find(a => a.launch.aumid);
  assert.match(packaged.bundleId, /^win32\.aumid\.[a-f0-9]{64}$/);
  assert.equal(packaged.running, false);
});
test('Windows rejects PID reuse and unreadable process paths', async () => {
  const apps = new WindowsApps({ readProcesses: async () => [row(42, 'C:\\Apps\\editor.exe', 'new'), row(43, null)], canonicalize });
  await assert.rejects(apps.verify({ ...row(42), executable: 'c:\\apps\\editor.exe' }), /进程已变化/);
  assert.equal((await apps.processes()).length, 1);
});

function fixture({ checks = ['ax_capability', 'screen_capture_capability'], reused = false } = {}) {
  const calls = [], grants = [], session = { id: 'windows', originChannel: 'desktop' };
  let settings = { enabled: true }, processReads = 0;
  const windowsApps = new WindowsApps({ canonicalize, readProcesses: async () => {
    processReads++;
    return [row(42, 'C:\\Apps\\editor.exe', reused && processReads >= 3 ? 'reused' : 'original')];
  } });
  const host = { supported: true, client: {}, connection: { pid: 7, driverVersion: '0.34.0' }, async call(name, args) {
    calls.push({ name, args });
    if (name === 'check_permissions') throw new Error('Legacy PowerShell integrity diagnostics are unavailable');
    const data = name === 'health_report' ? { checks: checks.map(name => ({ name, status: 'pass' })) }
      : name === 'list_apps' ? { apps: [{ pid: 42, running: true, kind: 'desktop', name: 'Editor' }] }
      : name === 'list_windows' ? { windows: [{ pid: 42, window_id: 123 }] }
      : name === 'get_window_state' ? { snapshot_id: 's00000001', elements: [{ element_token: 's00000001:1' }] } : {};
    return { content: [], structuredContent: data };
  }, async stop() {} };
  const control = new DesktopControlSession({ getSettings: () => settings, saveSettings: s => { settings = s; }, requestAccess: async request => { grants.push(request); return 'always'; } });
  const service = new ComputerUseService({ host, control, platform: 'win32', windowsApps }); control.adapter = service;
  return { host, service, calls, grants, session };
}
test('Windows uses live UIA/capture probes and authenticated embedded connection, without TCC', async () => {
  const { service, calls } = fixture();
  const status = await service.check();
  assert.equal(status.phase, 'ready');
  assert.equal(Object.hasOwn(status.permissions, 'elevated'), false);
  assert.equal(calls.some(c => c.name === 'check_permissions'), false);
  assert.equal(status.permissions.hostIdentity, true);
  assert.deepEqual(calls.find(c => c.name === 'health_report').args.include, ['ax_capability', 'screen_capture_capability']);
  const failed = fixture({ checks: ['ax_capability'] });
  assert.equal((await failed.service.check()).phase, 'error');
  await assert.rejects(failed.service.invoke({ action: 'list_apps' }, failed.session), /屏幕捕获/);
  const noUia = fixture({ checks: ['screen_capture_capability'] });
  assert.equal((await noUia.service.check()).permissions.accessibility, false);
  await assert.rejects(noUia.service.invoke({ action: 'list_apps' }, noUia.session), /UI Automation/);
});
test('Windows authorizes the discovered executable, dispatches UIA expand, and consumes snapshots', async () => {
  const { service, session, calls, grants } = fixture();
  const [app] = await service.listApps();
  const state = (await service.invoke({ action: 'get_window_state', app: app.bundleId, window_id: '123' }, session)).structuredContent;
  const input = { action: 'click', app: app.bundleId, window_id: '123', snapshot_id: state.snapshot_id, element_token: 's00000001:1', ax_action: 'expand' };
  await service.invoke(input, session);
  const click = calls.find(c => c.name === 'click');
  assert.equal(click.args.pid, 42); assert.equal(click.args.action, 'expand'); assert.equal(click.args.delivery_mode, 'background');
  assert.equal(grants[0].app.bundleId, app.bundleId);
  await assert.rejects(service.invoke(input, session), /新快照/);
});
test('Windows refuses an observed HWND when its PID was recycled before observation', async () => {
  const { service, session, calls } = fixture({ reused: true });
  const [app] = await service.listApps();
  await assert.rejects(service.invoke({ action: 'get_window_state', app: app.bundleId, window_id: '123' }, session), /不属于|进程已变化/);
  assert.equal(calls.some(c => c.name === 'get_window_state'), false);
});

test('discovery and status keep their data in the first normalized text block with timing metadata', async () => {
  const { service, session } = fixture();
  for (const action of ['list_apps', 'status']) {
    const result = await service.invoke({ action }, session);
    const normalized = normalizeResult({ ...result, structuredContent: { ...result.structuredContent, moss: { action, elapsed_ms: 1 } } });
    assert.equal(normalized.content.length, 1);
    const payload = JSON.parse(normalized.content[0].text);
    assert.equal(payload.moss.action, action);
    if (action === 'list_apps') { assert.equal(payload.apps.length, 1); assert.equal(typeof payload.apps[0].bundleId, 'string'); }
    else assert.equal(payload.enabled, true);
  }
});
