import { describe, expect, it } from "bun:test";
import { appearanceCssThemeId, appearanceThemeMode, resolvedTheme } from "./appearance";

describe("OpenIM appearance", () => {
  it("uses the Host themeMode field", () => {
    expect(resolvedTheme({ themeMode: "light" }, true)).toBe("light");
    expect(resolvedTheme({ themeMode: "dark" }, false)).toBe("dark");
  });

  it("follows the operating system only in system mode", () => {
    expect(resolvedTheme({ themeMode: "system" }, true)).toBe("dark");
    expect(resolvedTheme({ themeMode: "system" }, false)).toBe("light");
    expect(appearanceThemeMode()).toBe("system");
  });

  it("validates CSS presets", () => {
    expect(appearanceCssThemeId({ cssThemeId: "grid-theme" })).toBe("grid-theme");
    expect(appearanceCssThemeId({ cssThemeId: "unknown" as never })).toBe("default");
  });
});
