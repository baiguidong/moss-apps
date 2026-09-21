import * as React from "react";
import { createRoot } from "react-dom/client";
import { OpenIMView } from "@/components/openim-view";
import "@/styles.css";

type MossAppearance = {
  theme?: "light" | "dark" | "system";
};

function resolvedTheme(appearance?: MossAppearance | null): "light" | "dark" {
  if (appearance?.theme === "dark" || appearance?.theme === "light") return appearance.theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyAppearance(appearance?: MossAppearance | null) {
  document.documentElement.dataset.theme = resolvedTheme(appearance);
}

function App() {
  React.useEffect(() => {
    let disposed = false;
    void window.mossApp.app.getInfo().then((info: { appearance?: MossAppearance }) => {
      if (!disposed) applyAppearance(info?.appearance);
    }).catch(() => applyAppearance(null));
    const unsubscribe = window.mossApp.events.on("appearance", (appearance: MossAppearance) => {
      if (!disposed) applyAppearance(appearance);
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return <OpenIMView />;
}

applyAppearance(null);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
