import {
  AppBackendClient,
  type AppBackendContext,
} from "@moss/app-sdk";
import { createOpenIMAutomation } from "./automation";

let automation: ReturnType<typeof createOpenIMAutomation>;

const client = new AppBackendClient({
  onInitialize: async (nextContext: AppBackendContext) => {
    console.log(`[OpenIM] App Backend ready for ${nextContext.instanceId}`);
    automation.initialize(nextContext);
  },
  onShutdown: async () => {
    automation.shutdown();
    console.log("[OpenIM] App Backend stopped");
  },
  onFatalError: (error: unknown) => {
    console.error("[OpenIM] Fatal App Backend error", error);
    process.exitCode = 1;
  },
});

automation = createOpenIMAutomation(client);

client.start();
