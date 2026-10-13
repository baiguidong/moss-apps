import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComputerUseService } from '../src/native/service.mjs';
import { DesktopControlSession } from '@moss/app-runtime/desktop-control';

const session = { id: 'one', title: 'Test', agentMode: 'local', sessionKind: 'chat', originChannel: 'desktop' };
function fixture(overrides = {}) {
  const calls = []; let config = { enabled: true, apps: [] };
  let snapshot = 0;
  const host = { supported: true, client: {},
    async call(name, args) {
      calls.push({ name, args });
      const data = name === 'list_apps' ? { apps: [{ name: 'Example', kind: 'desktop', bundle_id: 'com.example.app', running: true, pid: 42 }] }
        : name === 'list_windows' ? { windows: [{ window_id: 100, pid: 42 }] }
        : name === 'get_window_state' ? { snapshot_id: `s${(++snapshot).toString(16).padStart(8, '0')}`, capture_id: `capture-${snapshot}`, screenshot_width: 600, screenshot_height: 400,
          elements: [{ element_token: `s${snapshot.toString(16).padStart(8, '0')}:1` }] }
        : name === 'check_permissions' ? { accessibility: true, screen_recording: true, source: { attribution: 'host', host_bundle_id: 'com.moss.ai' } }
        : name === 'health_report' ? { checks: [{ name: 'bundle_identity', status: 'pass', data: { bundle_identifier: 'com.moss.ai', identity_source: 'parent_application', parent_process_id: process.pid } }] } : {};
      return { content: name === 'get_window_state'
        ? [{ type: 'image', mimeType: 'image/png', data: 'test-image' }]
        : [{ type: 'text', text: 'ok' }], structuredContent: data };
    },
    async stop() { calls.push({ name: 'STOP' }); this.client = null; },
  };
  const control = new DesktopControlSession({ getSettings: () => config, saveSettings: v => { config = v; }, requestAccess: async () => 'session', ...overrides });
  const service = new ComputerUseService({ host, control, platform: 'darwin' });
  control.adapter = service;
  // Public lifecycle belongs to the real Host broker; driver state stays on the adapter.
  const api = new Proxy(service, { get: (target, name) => ['stop','finish','beginTurn','disposeSession','revoke'].includes(name) ? control[name].bind(control) : typeof target[name] === 'function' ? target[name].bind(target) : target[name] });
  service.permissions = { hostIdentity: true, accessibility: true, screenRecording: true };
  const observe = () => service.invoke({ action: 'get_window_state', app: 'com.example.app', window_id: '100' }, session);
  return { service: api, host, calls, observe, config: () => config };
}

test('app grant is required even when a caller supplies a PID or foreign target', async () => {
  const { service, calls } = fixture({ requestAccess: async () => 'deny' });
  await assert.rejects(service.invoke({ action: 'click', app: 'com.example.app', pid: 9, target: { pid: 9 }, window_id: '100' }, session), /未允许/);
  assert.equal(calls.some(c => c.name === 'click'), false);
});
test('actions bind to the authorized app and consume the observed snapshot', async () => {
  const { service, calls, observe } = fixture();
  const state = (await observe()).structuredContent;
  const input = { action: 'click', app: 'com.example.app', window_id: '100', snapshot_id: state.snapshot_id, element_token: state.elements[0].element_token, pid: 900, target: { kind: 'desktop' } };
  await service.invoke(input, session);
  const click = calls.find(c => c.name === 'click');
  assert.equal(click.args.pid, 42); assert.equal(click.args.window_id, 100); assert.equal(click.args.target, undefined);
  assert.equal(click.args.delivery_mode, 'background');
  await assert.rejects(service.invoke(input, session), /新快照/);
});
test('rejects out-of-window pixels, foreign elements and unsafe window integers', async () => {
  const { service, observe } = fixture();
  const s = (await observe()).structuredContent;
  const base = { action: 'click', app: 'com.example.app', window_id: '100', snapshot_id: s.snapshot_id };
  await assert.rejects(service.invoke({ ...base, x: 600, y: 0 }, session), /坐标/);
  await assert.rejects(service.invoke({ ...base, element_token: 's000000ff:1' }, session), /元素/);
  await assert.rejects(service.invoke({ ...base, window_id: '9007199254740993' }, session), /标识/);
});
test('foreground needs a separate grant and it expires with the control run', async () => {
  const requests = [];
  const { service, observe } = fixture({ requestAccess: async request => { requests.push(request.foreground); return 'session'; } });
  const s = (await observe()).structuredContent;
  await service.invoke({ action: 'press_key', app: 'com.example.app', window_id: '100', snapshot_id: s.snapshot_id, key: 'tab', foreground: true }, session);
  assert.deepEqual(requests, [false, true]);
  await service.finish(session.id);
  const next = (await observe()).structuredContent;
  await service.invoke({ action: 'press_key', app: 'com.example.app', window_id: '100', snapshot_id: next.snapshot_id, key: 'tab', foreground: true }, session);
  assert.deepEqual(requests, [false, true, true]);
});
test('pixel actions require an image with valid dimensions, while AX-only observations remain usable', async () => {
  const invalidCaptures = [
    result => { result.content = []; },
    result => { delete result.structuredContent.screenshot_width; },
    result => { result.structuredContent.screenshot_height = 0; },
    result => { result.structuredContent.screenshot_width = '600'; },
    result => { result.structuredContent.screenshot_frame_valid = false; },
  ];
  for (const invalidate of invalidCaptures) {
    const { service, host, calls, observe } = fixture();
    const call = host.call.bind(host);
    host.call = async (name, args) => {
      const result = await call(name, args);
      if (name === 'get_window_state') invalidate(result);
      return result;
    };
    const state = (await observe()).structuredContent;
    await assert.rejects(service.invoke({ action: 'type_text', app: 'com.example.app', window_id: '100',
      snapshot_id: state.snapshot_id, x: 10, y: 10, text: 'hello' }, session), /截图坐标范围/);
    assert.equal(calls.some(c => c.name === 'type_text'), false);
    await service.invoke({ action: 'click', app: 'com.example.app', window_id: '100',
      snapshot_id: state.snapshot_id, element_token: state.elements[0].element_token }, session);
    assert.equal(calls.filter(c => c.name === 'click').length, 1);
  }
});
test('valid pixel clicks use the observed capture identity and consume the snapshot', async () => {
  const { service, calls, observe } = fixture();
  const state = (await observe()).structuredContent;
  const input = { action: 'click', app: 'com.example.app', window_id: '100',
    snapshot_id: state.snapshot_id, x: 0, y: 0, count: 2 };
  await service.invoke(input, session);
  assert.deepEqual(calls.find(c => c.name === 'click').args, {
    pid: 42, window_id: 100, session: service.owner.runId,
    x: 0, y: 0, count: 2, capture_id: state.capture_id, delivery_mode: 'background',
  });
  await assert.rejects(service.invoke(input, session), /新快照/);
});
test('stopping during authorization prevents all subsequent native input', async () => {
  let allow; const approval = new Promise(resolve => { allow = resolve; });
  const { service, calls } = fixture({ requestAccess: () => approval });
  const request = service.invoke({ action: 'launch_app', app: 'com.example.app' }, session);
  await new Promise(resolve => setImmediate(resolve));
  await service.stop(); allow('always');
  await assert.rejects(request, /已停止/);
  assert.equal(calls.some(c => c.name === 'launch_app'), false);
  await assert.rejects(service.invoke({ action: 'list_apps' }, session), /已停止/);
});
test('another session cannot interleave and remote/unattended sessions are denied', async () => {
  const { service, observe } = fixture(); await observe();
  await assert.rejects(service.invoke({ action: 'list_apps' }, { ...session, id: 'two' }), /另一个/);
  for (const other of [{ agentMode: 'remote-direct' }, { sessionKind: 'cron' }, { originChannel: 'app:test' }, { isSubAgent: true }]) {
    await assert.rejects(service.invoke({ action: 'list_apps' }, { ...session, ...other }), /本机交互式/);
  }
});
test('stop between permission and identity checks does not relaunch the driver', async () => {
  const { service, host, calls } = fixture(); let release;
  host.call = async name => { calls.push({ name }); return new Promise(resolve => { release = resolve; }); };
  const check = service.check(); await new Promise(resolve => setImmediate(resolve));
  await service.stop(); release({ structuredContent: {}, content: [] }); await check;
  assert.equal(calls.some(c => c.name === 'health_report'), false);
});
