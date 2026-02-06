import { defineConfig } from "@playwright/test";

/**
 * Playwright Configuration for Electron E2E Tests
 *
 * Uses Playwright's native Electron support to launch and test the Electron app
 *
 * Artefakte werden in folgenden Ordnern gespeichert:
 * - test-results/     → Screenshots, Videos, Traces bei Fehlern
 * - playwright-report/ → HTML-Report mit allen Details
 *
 * Report öffnen: npx playwright show-report
 * Trace ansehen: npx playwright show-trace test-results/<test>/trace.zip
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // Electron tests should run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for Electron
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "on-failure" }]],
  // Increased timeout for CI environments where startup is slower
  timeout: process.env.CI ? 120000 : 60000,
  expect: {
    timeout: process.env.CI ? 30000 : 10000,
  },
  use: {
    // Trace: Zeichnet alle Aktionen auf (Netzwerk, DOM-Snapshots, Konsole)
    // "on" = immer, "on-first-retry" = nur bei Retry, "retain-on-failure" = nur bei Fehler behalten
    trace: "retain-on-failure",

    // Screenshots: "on" = nach jedem Test, "only-on-failure" = nur bei Fehler
    screenshot: "only-on-failure",

    // Video: "on" = immer, "retain-on-failure" = nur bei Fehler behalten
    video: "retain-on-failure",

    // Playwright 1.58+: Accessibility-Testing mit Aria-Snapshots
    // Ermöglicht das Testen von ARIA-Labels für bessere Accessibility
  },
  outputDir: "test-results",
});
