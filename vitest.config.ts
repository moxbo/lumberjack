import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Vitest 4.0.18+: Thread-Pool für schnellere parallele Tests
    pool: "threads",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: [
      "node_modules",
      "release",
      "dist-main",
      "scripts",
      "**/scripts/**",
    ],
    passWithNoTests: true,
    server: {
      deps: {
        external: [/scripts\/.*/],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "src/types/**",
        "node_modules/**",
      ],
      // Threshold für Coverage-Qualität (optional aktivieren)
      // thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
    testTimeout: 30000,
  },
});
