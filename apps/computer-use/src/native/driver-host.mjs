import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CUA_VERSION, CUA_HOST_BUNDLE_ID, CUA_ARTIFACTS } from './manifest.mjs';

// Only this module owns native SDK objects and the private MCP transport.
export class CuaDriverHost {
  constructor({ resourcesRoot, hostBundleId = CUA_HOST_BUNDLE_ID, onExit = () => {}, sdkLoader = () => import('@trycua/cua-driver') }) {
    this.resourcesRoot = resourcesRoot;
    this.onExit = onExit;
    this.sdkLoader = sdkLoader;
    this.epoch = 0;
    this.hostBundleId = hostBundleId;
  }
  get supported() { return Boolean(CUA_ARTIFACTS[`${process.platform}-${process.arch}`]) && (process.platform !== 'darwin' || Number(os.release().split('.')[0]) >= 23); }
  async start() {
    if (this.stopping) await this.stopping;
    if (this.client) return;
    if (this.starting) return this.starting;
    this.starting = this.#start(this.epoch).finally(() => { this.starting = null; });
    return this.starting;
  }
  async #start(epoch) {
    if (!this.supported) throw new Error('电脑操控支持 macOS 14+（Apple Silicon / Intel）和 Windows 10/11 x64。');
    const binaryPath = path.join(this.resourcesRoot, CUA_VERSION, `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver');
    await fs.access(binaryPath);
    if (process.platform !== 'win32') await fs.chmod(binaryPath, 0o755);
    const sdk = await this.sdkLoader();
    if (epoch !== this.epoch) throw new Error('电脑操控启动已取消。');
    // Upstream treats tool policies as trusted inherited configuration, not an
    // overridable EmbeddedDriverHostOptions environment entry.
    process.env.CUA_DRIVER_POLICY_FILE = path.join(this.resourcesRoot, 'policy.yaml');
    const host = sdk.EmbeddedCuaDriverHost.withOptions(sdk.EmbeddedDriverHostOptions.create({
      binaryPath, hostBundleId: this.hostBundleId,
      permissionMode: sdk.EmbeddedPermissionMode.Standard,
      startupTimeoutMs: 15000n, shutdownTimeoutMs: 5000n,
      approveCapabilityManifest: false, approveSessionPolicy: false,
      dangerouslyBypassApprovals: false, inheritStderr: false,
      environment: [
        { name: 'CUA_DRIVER_RS_TELEMETRY_ENABLED', value: '0' },
        { name: 'CUA_TELEMETRY_ENABLED', value: 'false' },
      ],
    }));
    this.host = host;
    try {
      const connection = await host.start();
      if (epoch !== this.epoch) throw new Error('电脑操控启动已取消。');
      if (connection.driverVersion !== CUA_VERSION) throw new Error(`Cua driver version mismatch: ${connection.driverVersion}`);
      const [{ Client }, { StdioClientTransport }] = await Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import('@modelcontextprotocol/sdk/client/stdio.js'),
      ]);
      const transport = new StdioClientTransport({
        command: connection.mcp.command, args: connection.mcp.args,
        env: Object.fromEntries(connection.mcp.environment.map(({ name, value }) => [name, value])),
        stderr: 'ignore',
      });
      const client = new Client({ name: 'moss-computer-use', version: '1.0.0' }, { capabilities: {} });
      this.transport = transport;
      await client.connect(transport);
      if (epoch !== this.epoch) { await client.close(); throw new Error('电脑操控启动已取消。'); }
      this.client = client;
      this.connection = connection;
      void host.waitForExit(connection.generation).then(() => {
        if (this.host === host && !this.stopping) {
          this.client = null;
          this.connection = null;
          void client.close().catch(() => {});
          this.onExit('电脑操控进程已退出；上一个动作结果可能未知，请重新观察。');
        }
      }).catch(() => {});
    } catch (error) {
      await this.transport?.close().catch(() => {});
      await host.stop().catch(() => {});
      host.uniffiDestroy();
      this.host = null;
      throw error;
    }
  }
  async call(name, args = {}, signal) {
    try {
      await this.start();
      return await this.client.callTool({ name, arguments: args }, undefined, { timeout: 30000, signal });
    } catch (error) {
      throw new Error(`${name}: ${error?.message || String(error)}`, { cause: error });
    }
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.epoch++;
    this.stopping = (async () => {
      // stop() also cancels a pending start in the upstream owner.
      const host = this.host;
      await host?.stop();
      await this.starting?.catch(() => {});
      await this.client?.close().catch(() => {});
      await this.transport?.close().catch(() => {});
      if (this.host === host) host?.uniffiDestroy();
      this.host = null;
      this.client = null;
      this.transport = null;
      this.connection = null;
    })().finally(() => { this.stopping = null; });
    return this.stopping;
  }
}
