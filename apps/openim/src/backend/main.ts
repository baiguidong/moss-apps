import { AppBackendClient, type AppBackendContext } from "@moss/app-sdk";
import { createOpenIMAutomation } from "./automation";
import { createOpenIMClientService } from "./openim-client";

const OPENIM_PROTOCOL = "moss.openim/v1";

let context: AppBackendContext | null = null;
let automation: ReturnType<typeof createOpenIMAutomation> | null = null;

const client = new AppBackendClient({
  onInitialize: async (nextContext: AppBackendContext) => {
    context = nextContext;
    if (nextContext.target.type !== "desktop") throw new Error("OpenIM App only supports Desktop.");
    desktopService.initialize(nextContext);
    automation = createOpenIMAutomation(client, desktopService);
    automation.initialize(nextContext);
    console.log(`[OpenIM] App Backend ready for ${nextContext.instanceId}`);
  },
  onShutdown: async () => {
    automation?.shutdown();
    automation = null;
    await desktopService.shutdown();
    context = null;
    console.log("[OpenIM] App Backend stopped");
  },
  onFatalError: (error: unknown) => {
    console.error("[OpenIM] Fatal App Backend error", error);
    process.exitCode = 1;
  },
});

const desktopService = createOpenIMClientService(client);

function requireDesktop() {
  if (!context) throw new Error("OpenIM App Backend is not initialized.");
  if (context.target.type !== "desktop") throw new Error("This action requires the Desktop backend.");
}

client.registerAction("status.get", async () => {
  requireDesktop();
  return desktopService.getStatus();
});

client.registerAction("session.ensure", async () => {
  requireDesktop();
  return desktopService.ensureSession();
});

client.registerAction("directory.list", async (input) => {
  requireDesktop();
  return client.host.request(OPENIM_PROTOCOL, "directory.list", input as Record<string, unknown>);
});

client.registerAction("conversation.direct.prepare", async (input) => {
  requireDesktop();
  return client.host.request(OPENIM_PROTOCOL, "conversation.direct.prepare", input as Record<string, unknown>);
});

client.registerAction("conversation.group.prepare", async (input) => {
  requireDesktop();
  return client.host.request(OPENIM_PROTOCOL, "conversation.group.prepare", input as Record<string, unknown>);
});

client.registerAction("sdk.call", async (input) => {
  requireDesktop();
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return desktopService.call(value.method, value.args);
});

client.registerAction("rtc.token", async () => {
  throw new Error("Audio and video calling is not configured.");
});

client.start();
