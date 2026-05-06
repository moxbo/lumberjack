import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

/**
 * Lockert im Dev-Modus die CSP aus index.html, damit Vite seine Styles
 * (die zur Laufzeit als <style>-Tags ins DOM injiziert werden) laden kann.
 * In Production bleibt die strikte CSP aus index.html unverändert erhalten.
 */
const devCspPlugin = () => ({
  name: "lumberjack-dev-csp",
  apply: "serve",
  transformIndexHtml(html) {
    // Ersetze nur das CSP-Meta-Tag und erweitere style-src/script-src
    // um die für Vite-Dev (inline-Style-Injection, eval) nötigen Quellen.
    return html.replace(
      /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i,
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:* https://localhost:* ws://localhost:* wss://localhost:*; worker-src 'self' blob:; font-src 'self' data:;" />`,
    );
  },
});

export default defineConfig({
  plugins: [preact(), devCspPlugin()],
  base: "./",
  // Disable HMR to prevent Prefresh render loop issues
  server: {
    hmr: false,
  },
  // Disable preact/debug in development to prevent render limit errors
  // The render limit in preact/debug is too strict for components with many hooks
  define: {
    // Prevent preact/debug from being included
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV === "production" ? "production" : "development",
    ),
  },
  optimizeDeps: {
    // Exclude prefresh and preact/debug from optimization
    exclude: ["@prefresh/core", "@prefresh/vite", "preact/debug"],
  },
  resolve: {
    dedupe: ["preact", "preact/hooks", "preact/compat"],
    alias: {
      // Alias preact/debug to an empty module in development
      // This prevents the "Too many re-renders" limit from triggering
      // Always apply in non-production to avoid render loop issues on Windows
      ...((process.env.NODE_ENV !== "production" || !process.env.NODE_ENV) && {
        "preact/debug": "preact",
      }),
    },
  },
  build: {
    // Optimize build for faster startup
    minify: "esbuild",
    target: "esnext",
    // Reduce chunk warnings
    chunkSizeWarningLimit: 1000,
    // Optimize CSS extraction for faster first paint
    cssCodeSplit: true,
    // Generate sourcemaps only in development
    sourcemap: process.env.NODE_ENV !== "production",
    rollupOptions: {
      // electron-log und adm-zip sind ausschließlich Main-Process-Module.
      // Schützt davor, dass sie versehentlich ins Renderer-Bundle landen,
      // falls jemand sie importiert (würde sonst Node-Internals ziehen).
      external: ["electron-log", "electron-log/main", "adm-zip", "electron"],
      output: {
        // Code splitting: split rarely-used features into separate chunks
        manualChunks: (id) => {
          // Normiere Pfadtrenner für Windows/macOS-Konsistenz
          const norm = id.replace(/\\/g, "/");
          // Core app bundle
          if (norm.includes("/node_modules/")) {
            // Keep core dependencies in main bundle for faster initial load
            if (
              norm.includes("/preact/") ||
              norm.includes("/@tanstack/react-virtual/")
            ) {
              return "vendor";
            }
            // Split other dependencies
            return "vendor-lazy";
          }
          // Split rarely-used dialogs and features
          if (norm.includes("/DCFilterDialog")) {
            return "dc-filter";
          }
          if (norm.includes("/src/store/") && !norm.includes("loggingStore")) {
            return "store-utils";
          }
          if (
            norm.includes("/src/utils/") &&
            !norm.includes("highlight") &&
            !norm.includes("msgFilter")
          ) {
            return "utils-lazy";
          }
        },
      },
    },
  },
  worker: {
    format: "es",
  },
});
