/**
 * Electron Test Fixtures for Playwright
 *
 * Provides reusable fixtures for launching and interacting with
 * the Lumberjack Electron application.
 */

import {
  test as base,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { _electron as electron } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom test fixture that launches the Electron app
export const test = base.extend<{
  electronApp: ElectronApplication;
  window: Page;
}>({
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    // Resolve main entry from project root
    const projectRoot = path.resolve(__dirname, "../..");
    const mainPath = path.join(projectRoot, "dist-main/main.cjs");

    // Verify the main entry point exists
    if (!fs.existsSync(mainPath)) {
      throw new Error(
        `Main entry point not found: ${mainPath}\n` +
          "Run 'npm run prebuild' to build the application first.",
      );
    }

    // Launch Electron app with the project directory as cwd
    const electronApp = await electron.launch({
      args: [mainPath],
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        LUMBERJACK_E2E_TEST: "1",
        // Disable hardware acceleration for CI stability
        LUMBERJACK_DISABLE_GPU: "1",
      },
      timeout: 60000,
    });

    // Use the fixture
    await use(electronApp);

    // Cleanup: close the app
    await electronApp.close();
  },

  window: async ({ electronApp }, use) => {
    // Wait for the first BrowserWindow to open
    const window = await electronApp.firstWindow();

    // Wait for the window to be fully loaded
    await window.waitForLoadState("domcontentloaded");

    // Use the fixture
    await use(window);
  },
});

export { expect };

/**
 * Helper to wait for the app to be fully initialized
 */
export async function waitForAppReady(
  window: Page,
  timeout = 30000,
): Promise<void> {
  // Wait for main content to be visible
  await window.waitForSelector('[data-testid="app-container"], #root, .app', {
    state: "visible",
    timeout,
  });
}

/**
 * Helper to take a screenshot with timestamp
 */
export async function takeDebugScreenshot(
  window: Page,
  name: string,
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await window.screenshot({
    path: `test-results/debug-${name}-${timestamp}.png`,
    fullPage: true,
  });
}

/**
 * Helper to get app info from main process
 */
export async function getAppInfo(electronApp: ElectronApplication): Promise<{
  name: string;
  version: string;
  isPackaged: boolean;
}> {
  return await electronApp.evaluate(async ({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    isPackaged: app.isPackaged,
  }));
}
