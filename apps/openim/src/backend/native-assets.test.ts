import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(require.resolve("@openim/electron-client-sdk/package.json")), "assets");

test("shipped native libraries match their declared processor architecture", () => {
  for (const [folder, cpu] of [["mac_arm64", 0x0100000c], ["mac_x64", 0x01000007]] as const) {
    const bytes = fs.readFileSync(path.join(root, folder, "libopenimsdk.dylib"));
    expect(bytes.readUInt32LE(0)).toBe(0xfeedfacf);
    expect(bytes.readUInt32LE(4)).toBe(cpu);
  }
  const windows = fs.readFileSync(path.join(root, "win_x64", "libopenimsdk.dll"));
  const pe = windows.readUInt32LE(0x3c);
  expect(windows.readUInt32LE(pe)).toBe(0x00004550);
  expect(windows.readUInt16LE(pe + 4)).toBe(0x8664);
  const linux = fs.readFileSync(path.join(root, "linux_x64", "libopenimsdk.so"));
  expect(linux.subarray(0, 4).toString("hex")).toBe("7f454c46");
  expect(linux.readUInt16LE(18)).toBe(62);
});
