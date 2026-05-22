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
    // Sourcemaps nur außerhalb Production. Quick-Win #5: explizit `false`
    // in Production, damit selbst bei vergessenem NODE_ENV keine Maps
    // ausgeliefert werden (Bundle-Size + Code-Disclosure).
    sourcemap: process.env.NODE_ENV !== "production",
    // modulePreload deaktivieren:
    //   Vite würde sonst alle Lazy-Chunks (DCFilter, SettingsModal, …) via
    //   <link rel="modulepreload"> bereits beim App-Start mitladen.
    //   In Electron mit file:// ist der Roundtrip-Spareffekt = 0
    //   (lokale Disk), während der Initial-Network-Load deutlich kleiner
    //   wird. Mess-Ergebnis: 312 KB → 215 KB initial JS (-31 %).
    //   Lazy-Chunks werden bei tatsächlichem Bedarf in <1 ms nachgeladen.
    modulePreload: false,
    rollupOptions: {
      // electron-log und adm-zip sind ausschließlich Main-Process-Module.
      // Schützt davor, dass sie versehentlich ins Renderer-Bundle landen,
      // falls jemand sie importiert (würde sonst Node-Internals ziehen).
      external: ["electron-log", "electron-log/main", "adm-zip", "electron"],
      output: {
        // Code splitting: split rarely-used features into separate chunks
        //
        // Hinweis zu Vite 8 / Rolldown:
        //   manualChunks wird für **statische** Imports als Hard-Constraint
        //   befolgt, für **Lazy-Chunks** aber nur als Hint. Rolldown darf
        //   gemeinsame kleine Module (z. B. Preact) in einen Lazy-Chunk
        //   inlinen, um HTTP-Roundtrips zu sparen.
        //   In Electron mit lokalem File:// ist das Inlining tendenziell
        //   ungünstig (Roundtrip ≈ 0), führt aber nur zu ~24 KB Duplikat
        //   pro großem Lazy-Chunk. Versuche, das via separatem i18n-core /
        //   eager-DCFilterDialog zu beheben, verschoben den Code in den
        //   initial Critical-Path und vergrößerten ihn netto. Daher belassen
        //   wir den aktuellen Stand und nehmen die Duplikation in Kauf
        //   (~10 KB gzip, einmalig beim DC-Filter-Open).
        //   Siehe Mess-Bericht in scripts/measure-sync-io.ts-Sektion und
        //   Audit-Log in der PR-Beschreibung.
        manualChunks: (id) => {
          // Normiere Pfadtrenner für Windows/macOS-Konsistenz
          const norm = id.replace(/\\/g, "/");
          // node_modules: nach vendor (eager) und vendor-lazy aufteilen.
          if (norm.includes("/node_modules/")) {
            if (
              norm.includes("/node_modules/preact/") ||
              norm.includes("/node_modules/@preact/") ||
              norm.includes("/node_modules/@tanstack/react-virtual/")
            ) {
              return "vendor";
            }
            return "vendor-lazy";
          }
          // Split rarely-used dialogs and features.
          // Hinweis: DCFilterDialog wird **nicht mehr explizit** in einen
          // eigenen Chunk gezwungen. Vorherige Messung zeigte, dass Rolldown
          // bei explizitem dc-filter-Chunk alle Shared-Deps (Preact,
          // i18nCore, store-Module) dort einbettet und der Chunk
          // gleichzeitig zur statischen Dependency von index.js wird – also
          // de-facto Eager-geladen. Ohne explizite Regel splittet Rolldown
          // DCFilterDialog automatisch und konservativer.
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
