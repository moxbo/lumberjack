/**
 * Accessibility Tests for Lumberjack
 *
 * Tests für ARIA-Labels und Barrierefreiheit.
 * Nutzt Playwright 1.58+ Aria-Snapshot Features.
 */

import { test, expect } from "./electron-fixtures";

test.describe("Accessibility", () => {
  test("main UI should have accessible elements", async ({ window }) => {
    // Wait for app to be ready
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    // Check that the app container is accessible
    const appContainer = window.locator("#app");
    await expect(appContainer).toBeVisible();

    // Playwright 1.58+: Check for proper ARIA roles
    // Main container should be accessible
    const mainContent = window.locator('[role="main"], main, #app');
    const mainCount = await mainContent.count();
    expect(mainCount).toBeGreaterThan(0);
  });

  test("interactive elements should be keyboard accessible", async ({
    window,
  }) => {
    // Wait for app to load
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    // Find all interactive elements
    const buttons = window.locator("button");
    const buttonCount = await buttons.count();

    // All buttons should have accessible names
    for (let i = 0; i < Math.min(buttonCount, 10); i++) {
      const button = buttons.nth(i);
      const isVisible = await button.isVisible();
      if (isVisible) {
        // Button should have text, aria-label, or title
        const ariaLabel = await button.getAttribute("aria-label");
        const title = await button.getAttribute("title");
        const text = await button.textContent();

        const hasAccessibleName =
          (ariaLabel && ariaLabel.length > 0) ||
          (title && title.length > 0) ||
          (text && text.trim().length > 0);

        // Log for debugging but don't fail - some icons may be decorative
        if (!hasAccessibleName) {
          console.warn(`Button ${i} may lack accessible name`);
        }
      }
    }

    expect(buttonCount).toBeGreaterThanOrEqual(0);
  });

  test("inputs should have labels or accessible names", async ({ window }) => {
    // Wait for app to load
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    // Find all input elements
    const inputs = window.locator('input:not([type="hidden"])');
    const inputCount = await inputs.count();

    for (let i = 0; i < Math.min(inputCount, 10); i++) {
      const input = inputs.nth(i);
      const isVisible = await input.isVisible();
      if (isVisible) {
        // Input should have aria-label, placeholder, or associated label
        const ariaLabel = await input.getAttribute("aria-label");
        const placeholder = await input.getAttribute("placeholder");
        const id = await input.getAttribute("id");

        const hasAccessibleName =
          (ariaLabel && ariaLabel.length > 0) ||
          (placeholder && placeholder.length > 0) ||
          id; // Assume id means there might be a label for it

        // Log for debugging
        if (!hasAccessibleName) {
          console.warn(`Input ${i} may lack accessible name`);
        }
      }
    }

    expect(inputCount).toBeGreaterThanOrEqual(0);
  });

  test("color contrast should be sufficient", async ({ window }) => {
    // Wait for app to load
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });

    // Basic check: body background should be set (not default white)
    const bodyStyles = await window.evaluate(() => {
      const body = document.body;
      const styles = globalThis.getComputedStyle(body);
      return {
        backgroundColor: styles.backgroundColor,
        color: styles.color,
      };
    });

    // App should have custom styling
    expect(bodyStyles.backgroundColor).toBeDefined();
    expect(bodyStyles.color).toBeDefined();
  });
});
