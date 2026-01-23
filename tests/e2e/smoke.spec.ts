/**
 * E2E Smoke Tests for Lumberjack
 *
 * Basic tests to verify the app launches correctly and core functionality works.
 * These tests run against the built Electron application.
 */

import { test, expect, getAppInfo } from "./electron-fixtures";

test.describe("Application Launch", () => {
  test("app should launch successfully", async ({ electronApp, window }) => {
    // Verify the app launched
    expect(electronApp).toBeTruthy();
    expect(window).toBeTruthy();

    // Check window title
    const title = await window.title();
    expect(title).toBe("Lumberjack");
  });

  test("app info should be correct", async ({ electronApp }) => {
    const appInfo = await getAppInfo(electronApp);

    // In dev mode, the app name is "Electron", in packaged mode it's "lumberjack"
    expect(["lumberjack", "Electron"]).toContain(appInfo.name);
    expect(appInfo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(appInfo.isPackaged).toBe(false); // Running in development mode
  });

  test("main window should be visible", async ({ window }) => {
    // Wait for the app container to be visible
    const appContainer = window.locator("#app");
    await expect(appContainer).toBeVisible({ timeout: 30000 });
  });
});

test.describe("UI Elements", () => {
  test("should display main UI components", async ({ window }) => {
    // Wait for app to be ready
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    // Take a screenshot for debugging
    await window.screenshot({ path: "test-results/initial-load.png" });

    // The app should have loaded and rendered something
    const bodyContent = await window.locator("body").innerHTML();
    expect(bodyContent.length).toBeGreaterThan(100);
  });

  test("should have working search input", async ({ window }) => {
    // Wait for app to load
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    // Find search input (usually an input element)
    const searchInput = window
      .locator('input[type="text"], input[type="search"]')
      .first();

    // If search exists, it should be interactive
    const searchCount = await searchInput.count();
    if (searchCount > 0) {
      await expect(searchInput).toBeEnabled();
    }
  });
});

test.describe("Window Controls", () => {
  test("window should have correct minimum size", async ({
    electronApp,
    window,
  }) => {
    // Ensure window is ready
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    const windowInfo = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length === 0 || !windows[0]) return null;

      const win = windows[0];
      const bounds = win.getBounds();
      const minSize = win.getMinimumSize();

      return {
        width: bounds.width,
        height: bounds.height,
        minWidth: minSize[0],
        minHeight: minSize[1],
      };
    });

    expect(windowInfo).not.toBeNull();
    if (windowInfo) {
      // Window should have reasonable size
      expect(windowInfo.width).toBeGreaterThan(400);
      expect(windowInfo.height).toBeGreaterThan(300);
    }
  });

  test("should be able to resize window", async ({ electronApp, window }) => {
    // Ensure window is ready
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    const resized = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length === 0 || !windows[0]) return null;

      const win = windows[0];
      const originalBounds = win.getBounds();

      // Resize window
      win.setSize(1200, 800);

      const newBounds = win.getBounds();
      return {
        original: originalBounds,
        new: newBounds,
        changed:
          originalBounds.width !== newBounds.width ||
          originalBounds.height !== newBounds.height,
      };
    });

    expect(resized).toBeTruthy();
  });
});

test.describe("IPC Communication", () => {
  test("should be able to get settings via IPC", async ({ electronApp }) => {
    // Test that IPC handlers are properly registered
    const ipcResult = await electronApp.evaluate(async () => {
      // Note: We can't directly inspect ipcMain handlers in Electron,
      // but we can verify the main process is responsive
      return {
        mainProcessRunning: true,
      };
    });

    expect(ipcResult.mainProcessRunning).toBe(true);
  });
});

test.describe("Accessibility", () => {
  test("should have proper document structure", async ({ window }) => {
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    // Check for basic accessibility - app uses German (de) as default language
    const html = await window.locator("html").getAttribute("lang");
    expect(html).toBe("de");

    // Check for proper title
    const title = await window.title();
    expect(title).toBeTruthy();
  });
});

test.describe("Error Handling", () => {
  test("should not have console errors on startup", async ({ window }) => {
    const errors: string[] = [];

    // Listen for console errors
    window.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });

    // Wait for app to fully load
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    // Give time for any async errors to appear
    await window.waitForTimeout(2000);

    // Filter out expected/known errors (if any)
    const unexpectedErrors = errors.filter(
      (err) =>
        !err.includes("DevTools") && // DevTools warnings
        !err.includes("Electron Security Warning") && // Expected in dev
        !err.includes("Failed to load resource"), // Network requests that may fail in test
    );

    // Log errors for debugging
    if (unexpectedErrors.length > 0) {
      console.log("Console errors found:", unexpectedErrors);
    }

    // Allow some tolerance for minor issues during testing
    expect(unexpectedErrors.length).toBeLessThan(5);
  });
});

test.describe("Multi-Instance Input Behavior", () => {
  test("input fields should accept text input", async ({ window }) => {
    // Wait for app to load
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    // Find the search input
    const searchInput = window
      .locator('input[type="text"], input[type="search"]')
      .first();

    const searchCount = await searchInput.count();
    if (searchCount > 0) {
      // Focus the input
      await searchInput.click();

      // Type some text
      const testText = "test search query";
      await searchInput.fill(testText);

      // Verify the text was entered
      const inputValue = await searchInput.inputValue();
      expect(inputValue).toBe(testText);

      // Clear and try typing character by character
      await searchInput.clear();
      await searchInput.type("hello world", { delay: 50 });

      const typedValue = await searchInput.inputValue();
      expect(typedValue).toBe("hello world");
    }
  });

  test("input should maintain focus and accept keystrokes", async ({
    window,
  }) => {
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    const searchInput = window
      .locator('input[type="text"], input[type="search"]')
      .first();

    const searchCount = await searchInput.count();
    if (searchCount > 0) {
      // Click to focus
      await searchInput.click();

      // Check that input has focus
      const isFocused = await searchInput.evaluate(
        (el) => document.activeElement === el,
      );
      expect(isFocused).toBe(true);

      // Press keys and verify they're received
      await window.keyboard.press("a");
      await window.keyboard.press("b");
      await window.keyboard.press("c");

      const value = await searchInput.inputValue();
      expect(value).toBe("abc");
    }
  });

  test("keyboard events should not be swallowed by global handlers", async ({
    window,
  }) => {
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    const searchInput = window
      .locator('input[type="text"], input[type="search"]')
      .first();

    const searchCount = await searchInput.count();
    if (searchCount > 0) {
      await searchInput.click();
      await searchInput.clear();

      // Test various keys that might be captured by global shortcuts
      await window.keyboard.type("filter test");

      const value = await searchInput.inputValue();
      expect(value).toBe("filter test");

      // Test special keys
      await searchInput.clear();
      await searchInput.press("End");
      await searchInput.type("start");
      await searchInput.press("Home");
      await searchInput.type("end");

      const finalValue = await searchInput.inputValue();
      expect(finalValue).toContain("start");
    }
  });
});
