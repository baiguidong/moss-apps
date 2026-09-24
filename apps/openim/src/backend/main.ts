import { AppBackendClient, MOSS_OPENIM_PROTOCOL, type AppBackendContext } from "@moss/app-sdk";
import { createOpenIMAutomation } from "./automation";
import { createOpenIMClientService } from "./openim-client";
import { installOpenIMShutdownHandlers } from "./lifecycle";

let context: AppBackendContext | null = null;
let automation: ReturnType<typeof createOpenIMAutomation> | null = null;

const shutdown = installOpenIMShutdownHandlers(async () => {
  automation?.shutdown();
  automation = null;
  await desktopService.shutdown();
  context = null;
  console.log("[OpenIM] App Backend stopped");
});

const client = new AppBackendClient({
  onInitialize: async (nextContext: AppBackendContext) => {
    context = nextContext;
    desktopService.initialize(nextContext);
    automation = createOpenIMAutomation(client, desktopService);
    automation.initialize(nextContext);
    console.log(`[OpenIM] App Backend ready for ${nextContext.instanceId}`);
  },
  onShutdown: shutdown,
  onFatalError: (error: unknown) => {
    console.error("[OpenIM] Fatal App Backend error", error);
    process.exitCode = 1;
  },
});

const desktopService = createOpenIMClientService(client);

function requireContext() {
  if (!context) throw new Error("OpenIM App Backend is not initialized.");
}

client.registerAction("status.get", async () => {
  requireContext();
  return desktopService.getStatus();
});

client.registerAction("session.ensure", async () => {
  requireContext();
  return desktopService.ensureSession();
});

client.registerAction("directory.list", async (input) => {
  requireContext();
  return client.host.request(MOSS_OPENIM_PROTOCOL, "directory.list", input as Record<string, unknown>);
});

client.registerAction("conversation.direct.prepare", async (input) => {
  requireContext();
  return client.host.request(MOSS_OPENIM_PROTOCOL, "conversation.direct.prepare", input as Record<string, unknown>);
});

client.registerAction("conversation.group.prepare", async (input) => {
  requireContext();
  return client.host.request(MOSS_OPENIM_PROTOCOL, "conversation.group.prepare", input as Record<string, unknown>);
});

client.registerAction("sdk.call", async (input) => {
  requireContext();
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return desktopService.call(value.method, value.args);
});

client.registerAction("rtc.token", async () => {
  throw new Error("Audio and video calling is not configured.");
});

client.start();
