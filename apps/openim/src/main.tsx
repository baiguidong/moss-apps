import * as React from "react";
import { createRoot } from "react-dom/client";
import { OpenIMView } from "@/components/openim-view";
import {
  appearanceCssThemeId,
  appearanceThemeMode,
  resolvedTheme,
  type MossAppearance,
} from "@/lib/appearance";
import "@/styles.css";

function applyAppearance(appearance: MossAppearance | null | undefined, prefersDark: boolean) {
  const theme = resolvedTheme(appearance, prefersDark);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.cssTheme = appearanceCssThemeId(appearance);
  document.documentElement.style.colorScheme = theme;
}

function App() {
  React.useEffect(() => {
    let disposed = false;
    let currentAppearance: MossAppearance | null = null;
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const updateAppearance = (appearance?: MossAppearance | null) => {
      currentAppearance = appearance || null;
      applyAppearance(currentAppearance, colorScheme.matches);
    };
    void window.mossApp.app.getInfo().then((info: { appearance?: MossAppearance }) => {
      if (!disposed) updateAppearance(info?.appearance);
    }).catch(() => updateAppearance(null));
    const unsubscribe = window.mossApp.events.on("appearance", (appearance: MossAppearance) => {
      if (!disposed) updateAppearance(appearance);
    });
    const handleSystemThemeChange = () => {
      if (!disposed && appearanceThemeMode(currentAppearance) === "system") {
        applyAppearance(currentAppearance, colorScheme.matches);
      }
    };
    colorScheme.addEventListener("change", handleSystemThemeChange);
    return () => {
      disposed = true;
      unsubscribe?.();
      colorScheme.removeEventListener("change", handleSystemThemeChange);
    };
  }, []);

  return <OpenIMView />;
}

applyAppearance(null, window.matchMedia("(prefers-color-scheme: dark)").matches);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
