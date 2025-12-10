import { render } from "preact";
import App from "../../renderer/App";
import { ErrorBoundary } from "../../renderer/ErrorBoundary";
import { I18nProvider } from "../../utils/i18n";
import "../styles.css";
import logger from "../../utils/logger";
import { rendererPerf } from "../../utils/rendererPerf";

// Mark when main.tsx starts executing
rendererPerf.mark("main-tsx-start");

// Memory monitoring for crash diagnostics
// Checks memory usage periodically and warns if it's getting critical
const MEMORY_CHECK_INTERVAL = 5000; // 5 seconds
const MEMORY_WARNING_THRESHOLD = 0.8; // 80% of JS heap limit
let lastMemoryWarning = 0;

function checkRendererMemory(): void {
  try {
    // @ts-expect-error - performance.memory is Chrome-specific
    const memory = performance.memory;
    if (memory) {
      const usedHeap = memory.usedJSHeapSize as number;
      const totalHeap = memory.jsHeapSizeLimit as number;
      const usage = usedHeap / totalHeap;

      // Log periodically for diagnostics
      if (Date.now() - lastMemoryWarning > 30000) {
        // Every 30 seconds
        const usedMB = (usedHeap / 1024 / 1024).toFixed(1);
        const totalMB = (totalHeap / 1024 / 1024).toFixed(1);
        const pct = (usage * 100).toFixed(1);
        console.warn(
          `[renderer-memory] Heap: ${usedMB}MB / ${totalMB}MB (${pct}%)`,
        );
        lastMemoryWarning = Date.now();
      }

      if (usage > MEMORY_WARNING_THRESHOLD) {
        const usedMB = (usedHeap / 1024 / 1024).toFixed(1);
        const totalMB = (totalHeap / 1024 / 1024).toFixed(1);
        const pct = (usage * 100).toFixed(1);
        console.error(
          `[RENDERER MEMORY CRITICAL] Usage at ${pct}% - crash may be imminent!`,
          {
            usedHeap: usedMB + "MB",
            totalHeap: totalMB + "MB",
            usage: pct + "%",
          },
        );
        // Try to report to main process
        try {
          // @ts-expect-error - access window.api for IPC
          window.api?.logRendererError?.({
            type: "memory-critical",
            usedHeap: usedMB,
            totalHeap: totalMB,
            usage: pct,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Ignore errors in memory checking
  }
}

// Start memory monitoring
setInterval(checkRendererMemory, MEMORY_CHECK_INTERVAL);

// Global error handlers for renderer process stability diagnostics
// These catch errors that escape the ErrorBoundary
window.onerror = (message, source, lineno, colno, error) => {
  const errorInfo = {
    type: "window.onerror",
    message: String(message),
    source,
    lineno,
    colno,
    stack: error?.stack,
    timestamp: new Date().toISOString(),
  };
  console.error("[RENDERER CRASH] Uncaught error:", errorInfo);
  logger.error("[RENDERER CRASH] Uncaught error:", errorInfo);
  // Try to report to main process
  try {
    // @ts-expect-error - access window.api for IPC
    window.api?.logRendererError?.(errorInfo);
  } catch {
    // Ignore if IPC unavailable
  }
  return false; // Allow default handling
};

window.onunhandledrejection = (event) => {
  const reason = event.reason;
  const errorInfo = {
    type: "unhandledrejection",
    reason:
      reason instanceof Error
        ? { message: reason.message, stack: reason.stack }
        : String(reason),
    timestamp: new Date().toISOString(),
  };
  console.error("[RENDERER CRASH] Unhandled rejection:", errorInfo);
  logger.error("[RENDERER CRASH] Unhandled rejection:", errorInfo);
  // Try to report to main process
  try {
    // @ts-expect-error - access window.api for IPC
    window.api?.logRendererError?.(errorInfo);
  } catch {
    // Ignore if IPC unavailable
  }
};

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
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>,
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
