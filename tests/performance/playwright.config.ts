import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { repetitions } from "./scenario";

// Deliberately outside the default E2E suite; there is no production instrumentation.
export default defineConfig({
  testDir: ".",
  testMatch: "filter.board.spec.ts",
  workers: 1,
  repeatEach: repetitions,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 90_000 },
  reporter: "list",
  outputDir: resolve("performance-board/runs"),
  use: { trace: "off", video: "off", screenshot: "off" },
});
