import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for Testcontainers-based integration tests.
 *
 * Run:  npm run test:integration
 *
 * Kept separate from vitest.config.ts so that `npm test` (unit tests) stays
 * fast and Docker-free.  Integration tests require Docker to be running and
 * pull real ES / OpenSearch container images on first use.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["node_modules"],
    // Container startup can take up to 3 min; individual HTTP requests < 10 s.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // Run suites sequentially in a single fork to avoid port conflicts between
    // containers and to prevent parallel Docker pulls from exhausting resources.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: false,
  },
});
