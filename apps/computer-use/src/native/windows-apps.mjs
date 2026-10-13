import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const id = (kind, value) => `win32.${kind}.${createHash('sha256').update(value).digest('hex')}`;

// Never authorize by Cua's shortcut/basename association. Bind running targets
// to a canonical executable and creation time from the OS, including PID reuse.
export async function readWindowsProcesses(signal) {
  const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.CreationDate } | ForEach-Object {
  @{ pid = [int]$_.ProcessId; executable = $_.ExecutablePath; started = $_.CreationDate.ToUniversalTime().ToString('o') }
}) | ConvertTo-Json -Compress`;
  const command = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await execute(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024, signal });
  const rows = stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, '')) : [];
  return Array.isArray(rows) ? rows : [rows];
}

export async function canonicalExecutable(value) {
  if (typeof value !== 'string' || !/^[a-z]:\\[^\0\r\n"<>|]*\.exe$/i.test(value)) return null;
  try { return (await fs.realpath(value)).replace(/^\\\\\?\\/, '').toLowerCase(); }
  catch { return null; }
}

export class WindowsApps {
  constructor({ readProcesses = readWindowsProcesses, canonicalize = canonicalExecutable } = {}) {
    Object.assign(this, { readProcesses, canonicalize });
  }
  async processes(signal) {
    const result = [];
    for (const row of await this.readProcesses(signal)) {
      if (!Number.isSafeInteger(row.pid) || row.pid <= 0 || typeof row.started !== 'string' || !row.started) continue;
      const executable = await this.canonicalize(row.executable);
      if (executable) result.push({ pid: row.pid, executable, started: row.started });
    }
    return result;
  }
  async list(rows, signal) {
    const processes = await this.processes(signal), byPid = new Map(processes.map(p => [p.pid, p]));
    const apps = new Map();
    const addExecutable = (executable, name, process) => {
      const bundleId = id('exe', executable);
      const app = apps.get(bundleId) || { bundleId, name, running: false, processes: [], launch: { path: executable }, executable };
      if (process && !app.processes.some(p => p.pid === process.pid)) app.processes.push(process);
      app.running = app.processes.length > 0;
      apps.set(bundleId, app);
    };
    for (const row of rows) {
      const process = row.running && byPid.get(row.pid);
      if (process) {
        // The shortcut's display name can refer to a different executable with
        // the same basename. Show the actual executable path in the grant UI.
        addExecutable(process.executable, `${path.win32.basename(process.executable)} · ${process.executable}`, process);
      }
      if (row.kind === 'uwp' && typeof row.bundle_id === 'string' && /^[\w.-]+![\w.-]+$/.test(row.bundle_id)) {
        const bundleId = id('aumid', row.bundle_id);
        apps.set(bundleId, { bundleId, name: `${row.name} · 启动入口`, running: false, processes: [], launch: { aumid: row.bundle_id } });
      } else if (row.kind === 'desktop' && typeof row.launch_path === 'string') {
        // Shortcuts with arbitrary arguments are not forwarded. Running apps
        // remain discoverable even when their shortcut cannot be safely used.
        const raw = row.launch_path.match(/^"([^"\r\n]+\.exe)"$/i)?.[1] || row.launch_path;
        const executable = await this.canonicalize(raw);
        if (executable) addExecutable(executable, `${row.name} · ${executable}`);
      }
    }
    return [...apps.values()];
  }
  async verify(process, signal) {
    const current = (await this.processes(signal)).find(p => p.pid === process.pid);
    if (!current || current.executable !== process.executable || current.started !== process.started) {
      throw new Error('应用进程已变化，请重新列出应用和窗口。');
    }
  }
}
