export type MossThemeMode = "light" | "dark" | "system";
export type MossCssThemeId = "default" | "grid-theme" | "dot-theme" | "gradient-theme";

export type MossAppearance = {
  themeMode?: MossThemeMode;
  cssThemeId?: MossCssThemeId;
};

const THEME_MODES = new Set<MossThemeMode>(["light", "dark", "system"]);
const CSS_THEME_IDS = new Set<MossCssThemeId>([
  "default",
  "grid-theme",
  "dot-theme",
  "gradient-theme",
]);

export function appearanceThemeMode(appearance?: MossAppearance | null): MossThemeMode {
  if (appearance?.themeMode && THEME_MODES.has(appearance.themeMode)) return appearance.themeMode;
  return "system";
}

export function resolvedTheme(
  appearance: MossAppearance | null | undefined,
  prefersDark: boolean,
): "light" | "dark" {
  const mode = appearanceThemeMode(appearance);
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}

export function appearanceCssThemeId(appearance?: MossAppearance | null): MossCssThemeId {
  return appearance?.cssThemeId && CSS_THEME_IDS.has(appearance.cssThemeId)
    ? appearance.cssThemeId
    : "default";
}
