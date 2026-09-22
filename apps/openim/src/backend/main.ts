import { AppBackendClient, type AppBackendContext } from "@moss/app-sdk";
import { createOpenIMAutomation } from "./automation";
import { createOpenIMClientService } from "./openim-client";
import { createOpenIMServerService } from "./openim-server";

let context: AppBackendContext | null = null;
let automation: ReturnType<typeof createOpenIMAutomation> | null = null;

const client = new AppBackendClient({
  onInitialize: async (nextContext: AppBackendContext) => {
    context = nextContext;
    if (nextContext.target.type === "desktop") {
      desktopService.initialize(nextContext);
      automation = createOpenIMAutomation(client, desktopService);
      automation.initialize(nextContext);
    } else {
      serverService.initialize(nextContext);
    }
    console.log(`[OpenIM] App Backend ready on ${nextContext.target.type} for ${nextContext.instanceId}`);
  },
  onShutdown: async () => {
    automation?.shutdown();
    automation = null;
    if (context?.target.type === "desktop") await desktopService.shutdown();
    else serverService.shutdown();
    context = null;
    console.log("[OpenIM] App Backend stopped");
  },
  onFatalError: (error: unknown) => {
    console.error("[OpenIM] Fatal App Backend error", error);
    process.exitCode = 1;
  },
});

const desktopService = createOpenIMClientService(client);
const serverService = createOpenIMServerService(client);

function requireTarget(target: "desktop" | "server") {
  if (!context) throw new Error("OpenIM App Backend is not initialized.");
  if (context.target.type !== target) throw new Error(`This action requires the ${target} backend.`);
}

client.registerAction("status.get", async () => {
  if (context?.target.type === "desktop") return desktopService.getStatus();
  requireTarget("server");
  return serverService.health();
});

client.registerAction("session.ensure", async () => {
  requireTarget("desktop");
  return desktopService.ensureSession();
});

client.registerAction("session.issue", async (input) => {
  requireTarget("server");
  return serverService.issueSession(input as { platformId?: unknown });
});

client.registerAction("directory.list", async (input) => {
  if (context?.target.type === "server") return serverService.listDirectory(input as { cursor?: unknown; limit?: unknown });
  requireTarget("desktop");
  return client.remote.request("action.invoke", {
    action: "directory.list",
    input: input as Record<string, unknown>,
    timeoutMs: 30_000,
    ownerScope: "org",
  });
});

client.registerAction("conversation.direct.prepare", async (input) => {
  if (context?.target.type === "server") return serverService.prepareDirect(input as { userId?: unknown });
  requireTarget("desktop");
  return client.remote.request("action.invoke", {
    action: "conversation.direct.prepare",
    input: input as Record<string, unknown>,
    timeoutMs: 30_000,
    ownerScope: "org",
  });
});

client.registerAction("conversation.group.prepare", async (input) => {
  if (context?.target.type === "server") return serverService.prepareGroup(input as { userIds?: unknown });
  requireTarget("desktop");
  return client.remote.request("action.invoke", {
    action: "conversation.group.prepare",
    input: input as Record<string, unknown>,
    timeoutMs: 30_000,
    ownerScope: "org",
  });
});

client.registerAction("sdk.call", async (input) => {
  requireTarget("desktop");
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  return desktopService.call(value.method, value.args);
});

client.registerAction("rtc.token", async () => {
  throw new Error("Audio and video calling is not configured.");
});

client.start();
