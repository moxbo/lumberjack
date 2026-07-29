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
      "scripts/**",
      // Integration tests live in *.integration.test.ts and require Docker;
      // run them separately with: npm run test:integration
      "src/**/*.integration.test.ts",
    ],
    passWithNoTests: false,
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
      // Coverage thresholds – global is kept low for now; gradually increase as more tests are added.
      // Per-file thresholds enforce high quality for already-tested modules.
      thresholds: {
        lines: 1,
        functions: 1,
        branches: 1,
        statements: 1,
        "src/services/CircuitBreaker.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/services/RateLimiter.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/services/FeatureFlags.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/services/AdaptiveBatchService.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/services/ShutdownCoordinator.ts": {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
        "src/services/LoggingStrategy.ts": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        "src/services/PerformanceService.ts": {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
        "src/utils/msgFilter.ts": {
          lines: 80,
          functions: 80,
          branches: 70,
          statements: 80,
        },
      },
    },
    testTimeout: 30000,
  },
});
