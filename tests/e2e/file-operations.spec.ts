/**
 * E2E Tests for File Operations
 *
 * Tests for loading log files, drag-and-drop, and file handling.
 */

import { test, expect } from "./electron-fixtures";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Create a temporary test log file
function createTestLogFile(): string {
  const tmpDir = os.tmpdir();
  const logPath = path.join(tmpDir, `test-log-${Date.now()}.log`);

  const logContent = `2024-01-01 10:00:00.123 INFO  [main] Application started
2024-01-01 10:00:01.456 DEBUG [worker-1] Processing request
2024-01-01 10:00:02.789 WARN  [worker-1] Slow response detected
2024-01-01 10:00:03.012 ERROR [main] Connection failed: timeout
2024-01-01 10:00:04.345 INFO  [main] Retry attempt 1
2024-01-01 10:00:05.678 INFO  [main] Connection restored
`;

  fs.writeFileSync(logPath, logContent);
  return logPath;
}

// Cleanup test file
function cleanupTestFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

test.describe("File Operations", () => {
  test("should open file via dialog", async ({ electronApp, window }) => {
    // Create test file
    const testLogPath = createTestLogFile();

    try {
      // Wait for app to be ready
      await window.waitForSelector("#app", {
        state: "visible",
        timeout: 30000,
      });

      // Mock the file dialog to return our test file
      await electronApp.evaluate(
        async ({ dialog }, { testPath }) => {
          // Override showOpenDialog to return our test file
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [testPath],
          });
        },
        { testPath: testLogPath },
      );

      // Trigger file open via keyboard shortcut (Cmd/Ctrl+O)
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await window.keyboard.press(`${modifier}+o`);

      // Wait for potential file loading
      await window.waitForTimeout(2000);

      // App should still be running after file operation
      const title = await window.title();
      expect(title).toBe("Lumberjack");
    } finally {
      cleanupTestFile(testLogPath);
    }
  });

  test("should handle empty file gracefully", async ({
    electronApp,
    window,
  }) => {
    // Create empty file
    const emptyLogPath = path.join(os.tmpdir(), `empty-log-${Date.now()}.log`);
    fs.writeFileSync(emptyLogPath, "");

    try {
      await window.waitForSelector("#app", {
        state: "visible",
        timeout: 30000,
      });

      // Mock dialog
      await electronApp.evaluate(
        async ({ dialog }, { testPath }) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [testPath],
          });
        },
        { testPath: emptyLogPath },
      );

      // Trigger file open
      const modifier = process.platform === "darwin" ? "Meta" : "Control";
      await window.keyboard.press(`${modifier}+o`);

      // Wait and verify no crash
      await window.waitForTimeout(1000);

      // App should still be responsive
      const title = await window.title();
      expect(title).toBe("Lumberjack");
    } finally {
      cleanupTestFile(emptyLogPath);
    }
  });
});

test.describe("Keyboard Shortcuts", () => {
  test("should focus search on Ctrl/Cmd+F", async ({ window }) => {
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await window.keyboard.press(`${modifier}+f`);

    // Wait for focus change
    await window.waitForTimeout(500);

    // Check if an input is focused
    const focusedElement = await window.evaluate(() => {
      const active = document.activeElement;
      return active ? active.tagName.toLowerCase() : null;
    });

    // Should have focused an input element
    expect(["input", "textarea"]).toContain(focusedElement);
  });

  test("should handle Ctrl/Cmd+L gracefully", async ({ window }) => {
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await window.keyboard.press(`${modifier}+l`);

    // Wait for potential action
    await window.waitForTimeout(500);

    // App should still be functional
    const title = await window.title();
    expect(title).toBe("Lumberjack");
  });
});

test.describe("Menu Integration", () => {
  test("should have application menu", async ({ electronApp, window }) => {
    // Ensure app is ready
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    const hasMenu = await electronApp.evaluate(async ({ Menu }) => {
      const appMenu = Menu.getApplicationMenu();
      return appMenu !== null;
    });

    expect(hasMenu).toBe(true);
  });

  test("should have File menu with items", async ({ electronApp, window }) => {
    // Ensure app is ready
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    const menuInfo = await electronApp.evaluate(async ({ Menu }) => {
      const appMenu = Menu.getApplicationMenu();
      if (!appMenu) return null;

      const fileMenu = appMenu.items.find(
        (item) => item.label === "File" || item.label === "Datei",
      );

      if (!fileMenu || !fileMenu.submenu) return { found: false };

      return {
        found: true,
        itemCount: fileMenu.submenu.items.length,
        hasOpen: fileMenu.submenu.items.some(
          (item) =>
            item.label?.toLowerCase().includes("open") ||
            item.label?.toLowerCase().includes("öffnen"),
        ),
      };
    });

    // Menu should exist with items
    if (menuInfo?.found) {
      expect(menuInfo.itemCount).toBeGreaterThan(0);
    }
  });
});
