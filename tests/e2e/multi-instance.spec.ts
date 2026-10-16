/**
 * E2E Tests for Multi-Instance Input Behavior
 *
 * Tests to verify that input fields work correctly when multiple instances
 * of the application are running simultaneously.
 */

import { test as base, expect } from "@playwright/test";
import { _electron as electron, ElectronApplication, Page } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const mainPath = path.join(projectRoot, "dist-main/main.cjs");

// Verify main entry point exists before running tests
if (!fs.existsSync(mainPath)) {
  throw new Error(
    `Main entry point not found: ${mainPath}\nRun 'npm run prebuild' first.`,
  );
}

async function launchApp(
  extraArgs: string[] = [],
): Promise<{ app: ElectronApplication; window: Page }> {
  const isCI = process.env.CI === "true" || process.env.CI === "1";

  const app = await electron.launch({
    args: [
      mainPath,
      ...extraArgs,
      ...(isCI
        ? [
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--no-sandbox",
            "--disable-dev-shm-usage",
          ]
        : []),
    ],
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      LUMBERJACK_E2E_TEST: "1",
      LUMBERJACK_DISABLE_GPU: isCI ? "1" : "0",
    },
    timeout: isCI ? 120000 : 60000,
  });

  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  return { app, window };
}

// Use base test to avoid fixture conflicts
const test = base;

test.describe("Multi-Instance Input Behavior", () => {
  test("secondary instance uses isolated Chromium session storage", async () => {
    const { app: app1, window: window1 } = await launchApp();

    try {
      const { app: app2, window: window2 } = await launchApp([
        "--multi-instance",
        "--new-window",
      ]);

      try {
        const paths1 = await app1.evaluate(async ({ app }) => ({
          userData: app.getPath("userData"),
          sessionData: app.getPath("sessionData"),
        }));
        const paths2 = await app2.evaluate(async ({ app }) => ({
          userData: app.getPath("userData"),
          sessionData: app.getPath("sessionData"),
        }));

        expect(paths2.userData).toBe(paths1.userData);
        expect(paths2.sessionData).not.toBe(paths1.sessionData);
        expect(paths2.sessionData).toContain("session-data");

        const storedValues = await Promise.all(
          [
            [window1, "primary"],
            [window2, "secondary"],
          ].map(async ([window, value]) =>
            (window as Page).evaluate(async (storedValue) => {
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open("multi-instance-check", 1);
                request.onupgradeneeded = () => {
                  request.result.createObjectStore("values");
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () =>
                  reject(
                    request.error ?? new Error("Opening IndexedDB failed"),
                  );
              });
              await new Promise<void>((resolve, reject) => {
                const transaction = db.transaction("values", "readwrite");
                transaction.objectStore("values").put(storedValue, "owner");
                transaction.oncomplete = () => resolve();
                transaction.onerror = () =>
                  reject(
                    transaction.error ??
                      new Error("Writing IndexedDB value failed"),
                  );
              });
              const result = await new Promise<string>((resolve, reject) => {
                const transaction = db.transaction("values", "readonly");
                const request = transaction.objectStore("values").get("owner");
                request.onsuccess = () => resolve(String(request.result));
                request.onerror = () =>
                  reject(
                    request.error ?? new Error("Reading IndexedDB failed"),
                  );
              });
              db.close();
              return result;
            }, value as string),
          ),
        );
        expect(storedValues).toEqual(["primary", "secondary"]);
      } finally {
        await app2.close();
      }
    } finally {
      await app1.close();
    }
  });

  test("input should work after launching second instance with --multi-instance flag", async () => {
    // Launch first instance
    const { app: app1, window: window1 } = await launchApp();

    try {
      // Wait for first instance to be ready
      await window1.waitForSelector("#app", {
        state: "visible",
        timeout: 30000,
      });

      // Launch second instance with multi-instance flag
      const { app: app2, window: window2 } = await launchApp([
        "--multi-instance",
        "--new-window",
      ]);

      try {
        // Wait for second instance to be ready
        await window2.waitForSelector("#app", {
          state: "visible",
          timeout: 30000,
        });

        // Test input in first window
        const searchInput1 = window1
          .locator('input[type="text"], input[type="search"]')
          .first();

        const searchCount1 = await searchInput1.count();
        if (searchCount1 > 0) {
          await searchInput1.click();
          await searchInput1.fill("test in window 1");
          const value1 = await searchInput1.inputValue();
          expect(value1).toBe("test in window 1");
        }

        // Test input in second window
        const searchInput2 = window2
          .locator('input[type="text"], input[type="search"]')
          .first();

        const searchCount2 = await searchInput2.count();
        if (searchCount2 > 0) {
          await searchInput2.click();
          await searchInput2.fill("test in window 2");
          const value2 = await searchInput2.inputValue();
          expect(value2).toBe("test in window 2");
        }

        // Switch focus back to first window and verify input still works
        if (searchCount1 > 0) {
          await searchInput1.click();
          await searchInput1.clear();
          await searchInput1.type("typing after switch", { delay: 20 });
          const finalValue1 = await searchInput1.inputValue();
          expect(finalValue1).toBe("typing after switch");
        }
      } finally {
        await app2.close();
      }
    } finally {
      await app1.close();
    }
  });

  test("keyboard input should be correctly routed to focused input across instances", async () => {
    // Launch first instance
    const { app: app1, window: window1 } = await launchApp();

    try {
      await window1.waitForSelector("#app", {
        state: "visible",
        timeout: 30000,
      });

      // Launch second instance
      const { app: app2, window: window2 } = await launchApp([
        "--multi-instance",
        "--new-window",
      ]);

      try {
        await window2.waitForSelector("#app", {
          state: "visible",
          timeout: 30000,
        });

        // Focus input in window 2
        const searchInput2 = window2
          .locator('input[type="text"], input[type="search"]')
          .first();

        const searchCount2 = await searchInput2.count();
        if (searchCount2 > 0) {
          await searchInput2.click();

          // Type using keyboard
          await window2.keyboard.type("keyboard test");

          const value = await searchInput2.inputValue();
          expect(value).toBe("keyboard test");

          // Clear and verify delete/backspace works
          await searchInput2.clear();
          await window2.keyboard.type("delete me");
          await window2.keyboard.press("Backspace");
          await window2.keyboard.press("Backspace");
          await window2.keyboard.press("Backspace");

          const valueAfterDelete = await searchInput2.inputValue();
          expect(valueAfterDelete).toBe("delete");
        }

        // Now verify input in window 1 still works
        const searchInput1 = window1
          .locator('input[type="text"], input[type="search"]')
          .first();

        const searchCount1 = await searchInput1.count();
        if (searchCount1 > 0) {
          await searchInput1.click();
          await window1.keyboard.type("window 1 after window 2");

          const value1 = await searchInput1.inputValue();
          expect(value1).toBe("window 1 after window 2");
        }
      } finally {
        await app2.close();
      }
    } finally {
      await app1.close();
    }
  });

  test("input focus should not be lost when switching between instances", async () => {
    const { app: app1, window: window1 } = await launchApp();

    try {
      await window1.waitForSelector("#app", {
        state: "visible",
        timeout: 30000,
      });

      const { app: app2, window: window2 } = await launchApp([
        "--multi-instance",
        "--new-window",
      ]);

      try {
        await window2.waitForSelector("#app", {
          state: "visible",
          timeout: 30000,
        });

        const searchInput1 = window1
          .locator('input[type="text"], input[type="search"]')
          .first();
        const searchInput2 = window2
          .locator('input[type="text"], input[type="search"]')
          .first();

        const hasInput1 = (await searchInput1.count()) > 0;
        const hasInput2 = (await searchInput2.count()) > 0;

        if (hasInput1 && hasInput2) {
          // Rapid focus switching
          for (let i = 0; i < 3; i++) {
            await searchInput1.click();
            await searchInput1.fill(`w1-${i}`);
            expect(await searchInput1.inputValue()).toBe(`w1-${i}`);

            await searchInput2.click();
            await searchInput2.fill(`w2-${i}`);
            expect(await searchInput2.inputValue()).toBe(`w2-${i}`);
          }

          // Final verification
          await searchInput1.click();
          await searchInput1.clear();
          await window1.keyboard.type("final test 1");
          expect(await searchInput1.inputValue()).toBe("final test 1");

          await searchInput2.click();
          await searchInput2.clear();
          await window2.keyboard.type("final test 2");
          expect(await searchInput2.inputValue()).toBe("final test 2");
        }
      } finally {
        await app2.close();
      }
    } finally {
      await app1.close();
    }
  });
});
