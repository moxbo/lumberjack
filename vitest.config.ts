import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
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
    },
    testTimeout: 30000,
  },
});
