import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOSS_OPENIM_PROTOCOL, MOSS_PLATFORM_PROTOCOL } from "@moss/app-sdk";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("OpenIM Desktop boundary", () => {
  it("uses the implicit Desktop runtime without target declarations", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, "app.moss.json"), "utf8"));
    const backendSource = fs.readFileSync(path.join(appRoot, "src/backend/main.ts"), "utf8");
    const clientSource = fs.readFileSync(path.join(appRoot, "src/backend/openim-client.ts"), "utf8");
    expect(manifest.backend).not.toHaveProperty("targets");
    expect(manifest.backend.protocols).toEqual(["moss.agent/v1", MOSS_PLATFORM_PROTOCOL, MOSS_OPENIM_PROTOCOL]);
    expect(manifest.backend.protocols).not.toContain("moss.remote/v1");
    expect(manifest.permissions).not.toContain("remote:actions");
    expect(manifest.backend).not.toHaveProperty("serverOwnerScope");
    expect(backendSource).not.toContain("client.remote");
    expect(backendSource).not.toContain("context.target");
    expect(clientSource).not.toContain("context.target");
    expect(backendSource).not.toContain("createOpenIMServerService");
  });
});
