import { render } from "preact";
import App from "../../renderer/App";
import { I18nProvider } from "../../utils/i18n";
import "../styles.css";
import logger from "../../utils/logger";
import { rendererPerf } from "../../utils/rendererPerf";

// Mark when main.tsx starts executing
rendererPerf.mark("main-tsx-start");

// Register service worker for caching static assets (deferred to avoid blocking startup)
// Guard registration: service workers require a secure origin (https:// or localhost)
// In Electron packaged apps the renderer is often loaded via file:// which can't register
// a service worker and results in errors like "Failed to register a ServiceWorker for scope ('file:///C:/')".
// Only attempt registration when not in dev and not loaded from file: protocol.
if (
  "serviceWorker" in navigator &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  !(import.meta as any).env?.DEV &&
  window?.location?.protocol !== "file:"
) {
  // Defer service worker registration until after initial render to avoid blocking
  requestIdleCallback(
    () => {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then((registration) => {
          logger.log("[App] ServiceWorker registered:", registration.scope);
        })
        .catch((error) => {
          logger.warn("[App] ServiceWorker registration failed:", error);
        });
    },
    { timeout: 5000 },
  );
}

rendererPerf.mark("pre-render");

const root = document.getElementById("app");
if (root) {
  render(
    <I18nProvider>
      <App />
    </I18nProvider>,
    root,
  );
  rendererPerf.mark("post-render");

  // Signal that the renderer is ready for first paint
  // Use requestAnimationFrame to ensure the render has painted
  requestAnimationFrame(() => {
    rendererPerf.mark("first-paint-ready");

    // Force a repaint to ensure the window can show without flashing
    requestAnimationFrame(() => {
      rendererPerf.mark("renderer-ready");
      logger.log("[App] Renderer ready for display");
    });
  });
}
