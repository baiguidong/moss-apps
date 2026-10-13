import { WindowsApps } from './windows-apps.mjs';
import { CUA_VERSION, CUA_HOST_BUNDLE_ID } from './manifest.mjs';
const fields = {
  get_window_state: ['query', 'include_screenshot', 'max_elements', 'max_depth'],
  click: ['element_token', 'x', 'y', 'button', 'count', 'action', 'modifier'],
  type_text: ['element_token', 'x', 'y', 'text'],
  press_key: ['element_token', 'x', 'y', 'key', 'modifiers'],
  hotkey: ['element_token', 'x', 'y', 'keys'],
  scroll: ['element_token', 'x', 'y', 'direction', 'amount', 'by'],
  set_value: ['element_token', 'value'],
};
const actions = new Set(['status', 'list_apps', 'launch_app', 'list_windows', 'end_session', ...Object.keys(fields)]);
const errorText = e => e?.inner?.reason || e?.message || String(e);
export function structured(result) {
  if (result?.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'Cua 操作失败。');
  return result?.structuredContent || {};
}
function windowNumber(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('窗口标识无效，请重新列出窗口。');
  return Number(value);
}


export class ComputerUseService {
  constructor({ host, control, expectedBundleId = CUA_HOST_BUNDLE_ID, platform = process.platform, windowsApps = new WindowsApps() }) {
    Object.assign(this, { host, control, expectedBundleId, platform, windowsApps });
    this.phase = control.settings().enabled ? 'not-checked' : 'disabled';
    this.error = ''; this.permissions = null; this.snapshots = new Map();
    for (const key of ['owner','epoch','inFlight','suspended']) Object.defineProperty(this, key, { get: () => control[key] });
    for (const method of ['settings','guard','changed','authorize']) this[method] = (...args) => control[method](...args);
    host.onExit = message => { this.error = message; this.phase = 'error'; void control.stop('driver-exit').catch(() => {}); };
  }
  status() { return { platform: this.platform, version: CUA_VERSION, supported: this.host.supported,
    phase: !this.settings().enabled ? 'disabled' : this.phase, permissions: this.permissions,
    error: this.error, captureVerified: Boolean(this.captureVerified) }; }
  async check({ restart = false, duringControl = false } = {}) {
    if (!this.settings().enabled || !this.host.supported) return this.status();
    if (this.owner && !duringControl) return this.status();
    if (this.checking) return this.checking;
    const epoch = this.epoch;
    this.checking = (async () => {
      this.phase = 'starting'; this.error = ''; this.changed();
      try {
        if (restart) { await this.host.stop(); this.captureVerified = false; }
        const p = structured(await this.host.call('check_permissions'));
        if (epoch !== this.epoch) return this.status();
        const health = structured(await this.host.call('health_report', { include: this.platform === 'win32' ? ['ax_capability', 'screen_capture_capability'] : ['bundle_identity'] }));
        if (epoch !== this.epoch) return this.status();
        if (this.platform === 'win32') {
          // EmbeddedCuaDriverHost.start authenticates the spawned PID and Host
          // ID before handing us the transport; Windows has no TCC attribution.
          const identityOk = Number(this.host.connection?.pid) > 0 && this.host.connection?.driverVersion === CUA_VERSION;
          this.permissions = { hostIdentity: identityOk,
            accessibility: p.uia === true && health.checks?.some(c => c.name === 'ax_capability' && c.status === 'pass'),
            screenRecording: health.checks?.some(c => c.name === 'screen_capture_capability' && c.status === 'pass') === true,
            elevated: p.elevated === true, integrityLevel: p.integrity_level || 'unknown' };
          if (!identityOk) throw new Error('Windows 驱动身份检查未通过，请重新检查。');
          this.phase = this.permissions.accessibility && this.permissions.screenRecording ? 'ready' : 'error';
          if (this.phase !== 'ready') this.error = 'Windows UI Automation 或屏幕捕获不可用，请确认当前桌面已登录并解锁。';
        } else {
        const identity = health.checks?.find(c => c.name === 'bundle_identity');
        const identityOk = p.source?.attribution === 'host' && p.source?.host_bundle_id === this.expectedBundleId
          && identity?.status === 'pass' && identity.data?.bundle_identifier === this.expectedBundleId
          && identity.data?.identity_source === 'parent_application' && identity.data?.parent_process_id === process.pid;
        this.permissions = { accessibility: p.accessibility === true, screenRecording: p.screen_recording === true,
          hostIdentity: identityOk, bundleId: identity.data?.bundle_identifier || p.source?.host_bundle_id };
        if (!identityOk) throw new Error('驱动未归属当前 Moss 应用。请从应用程序文件夹打开打包后的 Moss。');
        this.phase = p.accessibility && p.screen_recording ? 'ready' : 'needs-permission';
        }
      } catch (error) { if (epoch === this.epoch) { this.phase = 'error'; this.error = errorText(error); } }
      this.changed(); return this.status();
    })().finally(() => { this.checking = null; });
    return this.checking;
  }
  async ensureReady(session, epoch) {
    if (!this.permissions?.hostIdentity || !this.permissions.accessibility || !this.permissions.screenRecording || !this.host.client) {
      await this.check({ duringControl: true });
    }
    this.guard(session, epoch);
    if (!this.permissions?.hostIdentity || !this.permissions.accessibility || !this.permissions.screenRecording) {
      throw new Error(this.error || (this.platform === 'win32' ? 'Windows 电脑操控尚未就绪，请返回 App 重新检查。' : '请在系统设置开启辅助功能和屏幕录制，然后回到电脑操控 App重新检查。'));
    }
  }
  async listApps(signal) {
    const result = structured(await this.host.call('list_apps', {}, signal));
    if (this.platform === 'win32') return this.windowsApps.list(result.apps || [], signal);
    return (result.apps || []).filter(a => a.kind === 'desktop' && a.bundle_id)
      .map(a => ({ name: a.name, bundleId: a.bundle_id, running: a.running, pid: a.pid }));
  }

  async invoke(input, session, outerSignal) {
    this.control.assertLocal(session);
    if (!actions.has(input?.action)) throw new Error('不支持的电脑操控操作。');
    if (input.action === 'status') return { content: [{ type: 'text', text: JSON.stringify(this.control.status()) }] };
    if (input.action === 'end_session') { await this.control.finish(session.id); return { content: [{ type: 'text', text: '控制已结束。' }] }; }
    return this.control.run(session, outerSignal, async (signal, epoch) => {
      this.owner.action = input.action;
      try {
      await this.ensureReady(session, epoch);
      const apps = await this.listApps(signal); this.guard(session, epoch);
      if (input.action === 'list_apps') {
        const q = String(input.query || '').toLowerCase();
        return { content: [{ type: 'text', text: JSON.stringify({ apps: apps.filter(a => !q || `${a.name} ${a.bundleId}`.toLowerCase().includes(q)).map(a => ({ name: a.name, bundleId: a.bundleId, running: a.running })) }) }] };
      }
      const matches = apps.filter(a => a.bundleId === input.app || a.name === input.app);
      if (matches.length !== 1) throw new Error('应用不存在或名称不唯一，请先 list_apps，再使用准确 bundleId 应用标识。');
      let app = matches[0]; this.owner.app = { name: app.name, bundleId: app.bundleId }; this.changed();
      await this.authorize(session, app, input.foreground === true, signal, epoch);
      this.guard(session, epoch);
      const cuaSession = this.owner.runId;
      if (input.action === 'launch_app') {
        const result = await this.host.call('launch_app', { ...(app.launch || { bundle_id: app.bundleId }), session: cuaSession }, signal);
        if (this.platform === 'win32') result.content = [...(result.content || []), { type: 'text', text: '启动后请重新 list_apps，选择实际运行的应用标识并列出窗口。启动入口和运行进程分别授权。' }];
        return result;
      }
      const previous = app;
      app = (await this.listApps(signal)).find(a => a.bundleId === app.bundleId && a.running && (this.platform === 'win32' || a.pid === app.pid));
      this.guard(session, epoch);
      if (!app) throw new Error('应用未运行或进程已变化，请重新列出应用和窗口，必要时先 launch_app。');
      const processes = app.processes || [{ pid: app.pid }];
      const allWindows = [];
      for (const process of processes) {
        if (!Number.isSafeInteger(process.pid) || process.pid <= 0) continue;
        if (this.platform === 'win32' && !previous.processes.some(p => p.pid === process.pid && p.started === process.started)) continue;
        const data = structured(await this.host.call('list_windows', { pid: process.pid, session: cuaSession }, signal));
        this.guard(session, epoch);
        allWindows.push(...(data.windows || []).filter(w => w.pid === process.pid));
      }
      if (input.action === 'list_windows') return { content: [{ type: 'text', text: JSON.stringify({ windows: allWindows }) }], structuredContent: { windows: allWindows } };
      const windowId = windowNumber(input.window_id);
      const selectedWindow = allWindows.find(w => String(w.window_id) === String(windowId));
      if (!selectedWindow) throw new Error('目标窗口已关闭或不属于该应用，请重新列出窗口。');
      const selectedProcess = processes.find(p => p.pid === selectedWindow.pid);
      const args = { pid: selectedProcess.pid, window_id: windowId, session: cuaSession };
      for (const key of fields[input.action]) {
        if (key === 'action') { if (input.ax_action !== undefined) args.action = input.ax_action; }
        else if (input[key] !== undefined) args[key] = input[key];
      }
      const key = `${selectedProcess.pid}:${selectedProcess.started || ''}:${windowId}`;
      if (input.action === 'get_window_state') {
        args.max_elements = Math.min(Math.max(Number(args.max_elements) || 600, 1), 1500);
        args.max_depth = Math.min(Math.max(Number(args.max_depth) || 25, 1), 40);
        args.timeout_ms = 5000; args.max_image_dimension = 1440;
      } else {
        const snapshot = this.snapshots.get(key);
        if (!snapshot || snapshot.id !== input.snapshot_id || Date.now() - snapshot.time > 60_000) throw new Error('需要先获取当前窗口的新快照，再使用它的 snapshot_id 执行动作。');
        if (args.element_token && !snapshot.tokens.has(args.element_token)) throw new Error('元素不属于当前窗口快照。');
        if (args.x !== undefined || args.y !== undefined) {
          if (!snapshot.hasImage || snapshot.frameValid === false
            || !Number.isFinite(snapshot.width) || !Number.isFinite(snapshot.height)
            || snapshot.width <= 0 || snapshot.height <= 0) {
            throw new Error('当前快照没有有效的截图坐标范围，请重新获取包含截图的窗口状态。');
          }
          if (!Number.isFinite(args.x) || !Number.isFinite(args.y) || args.x < 0 || args.y < 0 || args.x >= snapshot.width || args.y >= snapshot.height) throw new Error('坐标不在当前窗口截图内。');
          if (input.action === 'click') args.capture_id = snapshot.captureId;
        }
        if (input.action === 'click' && !args.element_token && args.x === undefined) throw new Error('点击需要元素 token 或截图坐标。');
        if (input.action === 'set_value' && !args.element_token) throw new Error('设置控件值需要元素 token。');
        if (typeof args.text === 'string' && args.text.length > 10000) throw new Error('单次输入最多 10000 字符。');
        if (input.action !== 'set_value') args.delivery_mode = input.foreground === true ? 'foreground' : 'background';
        this.snapshots.delete(key);
      }
      this.guard(session, epoch);
      if (this.platform === 'win32') {
        if (args.action === 'press') delete args.action;
        if (args.action && !['invoke', 'expand'].includes(args.action)) throw new Error('Windows 元素动作仅支持 invoke 或 expand。');
        await this.windowsApps.verify(selectedProcess, signal);
        this.guard(session, epoch);
      }
      const result = await this.host.call(input.action, args, signal);
      if (input.action === 'get_window_state' && !result.isError) {
        const state = structured(result);
        const hasImage = result.content?.some(c => c.type === 'image') === true;
        this.snapshots.clear();
        this.snapshots.set(key, { id: state.snapshot_id, captureId: state.capture_id, time: Date.now(),
          hasImage, frameValid: state.screenshot_frame_valid,
          tokens: new Set((state.elements || []).map(e => e.element_token)), width: state.screenshot_width, height: state.screenshot_height });
        if (hasImage) this.captureVerified = true;
      }
      this.phase = 'ready'; this.error = '';
      return result;
    } catch (error) {
      this.error = errorText(error);
      if (!signal.aborted && /timeout|closed|connection/i.test(this.error)) await this.control.stop('transport-error', session.id);
      throw error;

      }
    });
  }
  async finish(runId) {
    try { if (this.host.client) await this.host.call('end_session', { session: runId }); }
    finally { this.snapshots.clear(); }
  }
  async stop() {
    this.snapshots.clear(); this.captureVerified = false; this.permissions = null;
    this.phase = 'stopping'; this.changed();
    try { await this.host.stop(); this.phase = this.settings().enabled ? 'not-checked' : 'disabled'; }
    catch (error) { this.error = `停止失败：${errorText(error)}`; this.phase = 'error'; throw error; }
  }
}
