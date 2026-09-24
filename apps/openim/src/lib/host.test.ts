import { expect, it } from "bun:test";
import fs from "node:fs";
import { MOSS_PLATFORM_PROTOCOL, PLATFORM_HOST_METHOD_PERMISSIONS, validatePlatformHostInput } from "@moss/app-sdk";
import { openIMHost, resetOpenIMHostInstance } from "./host";

it("selects and downloads files using the Platform protocol declared by the App", async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../../app.moss.json", import.meta.url), "utf8"));
  const previousWindow = globalThis.window;
  const calls: Array<{ protocol: string; method: string; input: unknown }> = [];
  const file = { name: "report.pdf", path: "/app/platform-files/report.pdf", size: 1024, mediaUrl: "moss-media://file" };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      mossApp: {
        instances: { list: async () => [{ id: "moss.openim--default", enabled: true }] },
        host: {
          request: async (instanceId: string, protocol: string, method: keyof typeof PLATFORM_HOST_METHOD_PERMISSIONS, input: unknown) => {
            expect(instanceId).toBe("moss.openim--default");
            expect(protocol).toBe(MOSS_PLATFORM_PROTOCOL);
            expect(manifest.backend.protocols).toContain(protocol);
            expect(manifest.permissions).toContain(PLATFORM_HOST_METHOD_PERMISSIONS[method]);
            validatePlatformHostInput(method, input);
            calls.push({ protocol, method, input });
            if (method === "file.pick") return { files: [file] };
            if (method === "file.download") return { canceled: false, filePath: "/downloads/report.pdf" };
            throw new Error(`Unexpected method: ${method}`);
          },
        },
      },
    },
  });
  resetOpenIMHostInstance();
  try {
    expect(await openIMHost.pickFiles({ kind: "file" })).toEqual([file]);
    expect(await openIMHost.download({ url: "https://files.example/report.pdf", fileName: "report.pdf" }))
      .toEqual({ canceled: false, filePath: "/downloads/report.pdf" });
    expect(calls.map(call => call.method)).toEqual(["file.pick", "file.download"]);
  } finally {
    resetOpenIMHostInstance();
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});
