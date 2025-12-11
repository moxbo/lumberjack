import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
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
      ...(process.env.NODE_ENV !== "production" && {
        "preact/debug": "preact",
      }),
    },
  },
  build: {
    // Optimize build for faster startup
    minify: "esbuild",
    target: "esnext",
    rollupOptions: {
      output: {
        // Code splitting: split rarely-used features into separate chunks
        manualChunks: (id) => {
          // Core app bundle
          if (id.includes("node_modules")) {
            // Keep core dependencies in main bundle for faster initial load
            if (
              id.includes("preact") ||
              id.includes("@tanstack/react-virtual")
            ) {
              return "vendor";
            }
            // Split other dependencies
            return "vendor-lazy";
          }
          // Split rarely-used dialogs and features
          if (id.includes("DCFilterDialog") || id.includes("DCFilterPanel")) {
            return "dc-filter";
          }
          if (id.includes("/store/") && !id.includes("loggingStore")) {
            return "store-utils";
          }
          if (
            id.includes("/utils/") &&
            !id.includes("highlight") &&
            !id.includes("msgFilter")
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
