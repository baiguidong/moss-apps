import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("OpenIM Desktop boundary", () => {
  it("does not declare or call a Server App Backend", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, "app.moss.json"), "utf8"));
    const backendSource = fs.readFileSync(path.join(appRoot, "src/backend/main.ts"), "utf8");
    expect(manifest.backend.targets).toEqual(["desktop"]);
    expect(manifest.backend.protocols).toContain("moss.openim/v1");
    expect(manifest.backend.protocols).not.toContain("moss.remote/v1");
    expect(manifest.permissions).not.toContain("remote:actions");
    expect(manifest.backend).not.toHaveProperty("serverOwnerScope");
    expect(backendSource).not.toContain("client.remote");
    expect(backendSource).not.toContain("createOpenIMServerService");
  });
});
