/**
 * E2E Tests for Message Filter Functionality
 *
 * Tests the message filter with logical operators (AND, OR, NOT)
 * and escape mechanism for literal special characters.
 */

import { test, expect } from "./electron-fixtures";

test.describe("Message Filter", () => {
  test.beforeEach(async ({ window }) => {
    // Wait for app to be ready
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });
    // Give the app more time to fully render
    await window.waitForTimeout(1000);
  });

  test("message filter input should be visible and enabled", async ({
    window,
  }) => {
    const filterInput = window.locator("#filterMessage");
    await expect(filterInput).toBeVisible({ timeout: 10000 });
    await expect(filterInput).toBeEnabled();
  });

  test("should accept AND operator (&) in filter", async ({ window }) => {
    const filterInput = window.locator("#filterMessage");
    await filterInput.focus();
    await filterInput.fill("foo&bar");

    const value = await filterInput.inputValue();
    expect(value).toBe("foo&bar");
  });

  test("should accept OR operator (|) in filter", async ({ window }) => {
    const filterInput = window.locator("#filterMessage");
    await filterInput.focus();
    await filterInput.fill("foo|bar");

    const value = await filterInput.inputValue();
    expect(value).toBe("foo|bar");
  });

  test("should accept NOT operator (!) in filter", async ({ window }) => {
    const filterInput = window.locator("#filterMessage");
    await filterInput.focus();
    await filterInput.fill("foo&!bar");

    const value = await filterInput.inputValue();
    expect(value).toBe("foo&!bar");
  });

  test("should accept parentheses for grouping in filter", async ({
    window,
  }) => {
    const filterInput = window.locator("#filterMessage");
    await filterInput.focus();
    await filterInput.fill("xml&(CB|AGV)");

    const value = await filterInput.inputValue();
    expect(value).toBe("xml&(CB|AGV)");
  });

  test("should accept escaped special characters in filter", async ({
    window,
  }) => {
    const filterInput = window.locator("#filterMessage");
    await filterInput.focus();
    // Note: In the UI, user types backslash followed by &
    // This tests that the input accepts the escape sequence
    await filterInput.fill("Tom\\&Jerry");

    const value = await filterInput.inputValue();
    expect(value).toBe("Tom\\&Jerry");
  });

  test("should accept complex filter expression with escape and operators", async ({
    window,
  }) => {
    const filterInput = window.locator("#filterMessage");
    await filterInput.focus();
    await filterInput.fill("Tom\\&Jerry&cartoon");

    const value = await filterInput.inputValue();
    expect(value).toBe("Tom\\&Jerry&cartoon");
  });

  test("msgMatches function should work correctly via window API", async ({
    window,
  }) => {
    // Test the msgMatches function directly via the debug API
    // This tests the actual filter logic, not just the UI input

    const result = await window.evaluate(() => {
      // Access the msgMatches function if exposed
      const w = window as any;
      if (w.ljDebug && typeof w.ljDebug.msgMatches === "function") {
        return {
          hasFunction: true,
          // Test cases
          simpleMatch: w.ljDebug.msgMatches("foo bar", "foo"),
          andMatch: w.ljDebug.msgMatches("foo bar", "foo&bar"),
          andNoMatch: w.ljDebug.msgMatches("foo qux", "foo&bar"),
          orMatch: w.ljDebug.msgMatches("foo", "foo|bar"),
          notMatch: w.ljDebug.msgMatches("foo qux", "foo&!bar"),
          notNoMatch: w.ljDebug.msgMatches("foo bar", "foo&!bar"),
          escapeMatch: w.ljDebug.msgMatches("Tom&Jerry", "Tom\\&Jerry"),
          escapeNoMatch: w.ljDebug.msgMatches("Tom Jerry", "Tom\\&Jerry"),
        };
      }
      return { hasFunction: false };
    });

    // If the debug API exposes msgMatches, verify the results
    if (result.hasFunction) {
      expect(result.simpleMatch).toBe(true);
      expect(result.andMatch).toBe(true);
      expect(result.andNoMatch).toBe(false);
      expect(result.orMatch).toBe(true);
      expect(result.notMatch).toBe(true);
      expect(result.notNoMatch).toBe(false);
      expect(result.escapeMatch).toBe(true);
      expect(result.escapeNoMatch).toBe(false);
    }
  });
});

// Tests for msgMatches filter logic via the debug API
// These tests verify that the filter logic works correctly without needing
// to inject test entries into the UI (which requires complex setup)
test.describe("Message Filter Logic via Debug API", () => {
  test.beforeEach(async ({ window }) => {
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });
    await window.waitForTimeout(500);
  });

  test("AND filter logic should work correctly", async ({ window }) => {
    const results = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.msgMatches) return null;
      return {
        // "foo bar baz" should match "foo&bar"
        match1: w.ljDebug.msgMatches("foo bar baz", "foo&bar"),
        // "foo only" should NOT match "foo&bar"
        match2: w.ljDebug.msgMatches("foo only", "foo&bar"),
        // "bar only" should NOT match "foo&bar"
        match3: w.ljDebug.msgMatches("bar only", "foo&bar"),
        // "something else" should NOT match "foo&bar"
        match4: w.ljDebug.msgMatches("something else", "foo&bar"),
      };
    });

    expect(results).not.toBeNull();
    expect(results?.match1).toBe(true);
    expect(results?.match2).toBe(false);
    expect(results?.match3).toBe(false);
    expect(results?.match4).toBe(false);
  });

  test("OR filter logic should work correctly", async ({ window }) => {
    const results = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.msgMatches) return null;
      return {
        // "foo message" should match "foo|bar"
        match1: w.ljDebug.msgMatches("foo message", "foo|bar"),
        // "bar message" should match "foo|bar"
        match2: w.ljDebug.msgMatches("bar message", "foo|bar"),
        // "baz message" should NOT match "foo|bar"
        match3: w.ljDebug.msgMatches("baz message", "foo|bar"),
      };
    });

    expect(results).not.toBeNull();
    expect(results?.match1).toBe(true);
    expect(results?.match2).toBe(true);
    expect(results?.match3).toBe(false);
  });

  test("NOT filter logic should work correctly", async ({ window }) => {
    const results = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.msgMatches) return null;
      return {
        // "error occurred in module A" should NOT match "error&!A"
        match1: w.ljDebug.msgMatches("error occurred in module A", "error&!A"),
        // "error occurred in module B" should match "error&!A"
        match2: w.ljDebug.msgMatches("error occurred in module B", "error&!A"),
        // "warning in module A" should NOT match "error&!A"
        match3: w.ljDebug.msgMatches("warning in module A", "error&!A"),
      };
    });

    expect(results).not.toBeNull();
    expect(results?.match1).toBe(false);
    expect(results?.match2).toBe(true);
    expect(results?.match3).toBe(false);
  });

  test("escaped ampersand should match literal & character", async ({
    window,
  }) => {
    const results = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.msgMatches) return null;
      return {
        // "Tom&Jerry cartoon" should match "Tom\&Jerry"
        match1: w.ljDebug.msgMatches("Tom&Jerry cartoon", "Tom\\&Jerry"),
        // "Tom and Jerry cartoon" should NOT match "Tom\&Jerry"
        match2: w.ljDebug.msgMatches("Tom and Jerry cartoon", "Tom\\&Jerry"),
        // "Tom Jerry" should NOT match "Tom\&Jerry"
        match3: w.ljDebug.msgMatches("Tom Jerry", "Tom\\&Jerry"),
        // "Research & Development" should NOT match "Tom\&Jerry"
        match4: w.ljDebug.msgMatches("Research & Development", "Tom\\&Jerry"),
      };
    });

    expect(results).not.toBeNull();
    expect(results?.match1).toBe(true);
    expect(results?.match2).toBe(false);
    expect(results?.match3).toBe(false);
    expect(results?.match4).toBe(false);
  });

  test("complex filter with escape and operators should work", async ({
    window,
  }) => {
    const results = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.msgMatches) return null;
      return {
        // "Tom&Jerry cartoon episode 1" should match "Tom\&Jerry&cartoon"
        match1: w.ljDebug.msgMatches(
          "Tom&Jerry cartoon episode 1",
          "Tom\\&Jerry&cartoon",
        ),
        // "Tom&Jerry movie" should NOT match "Tom\&Jerry&cartoon"
        match2: w.ljDebug.msgMatches("Tom&Jerry movie", "Tom\\&Jerry&cartoon"),
        // "Tom and Jerry cartoon" should NOT match "Tom\&Jerry&cartoon"
        match3: w.ljDebug.msgMatches(
          "Tom and Jerry cartoon",
          "Tom\\&Jerry&cartoon",
        ),
      };
    });

    expect(results).not.toBeNull();
    expect(results?.match1).toBe(true);
    expect(results?.match2).toBe(false);
    expect(results?.match3).toBe(false);
  });

  test("parentheses grouping should work correctly", async ({ window }) => {
    const results = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.msgMatches) return null;
      return {
        // "xml data from CB system" should match "xml&(CB|AGV)"
        match1: w.ljDebug.msgMatches("xml data from CB system", "xml&(CB|AGV)"),
        // "xml data from AGV system" should match "xml&(CB|AGV)"
        match2: w.ljDebug.msgMatches(
          "xml data from AGV system",
          "xml&(CB|AGV)",
        ),
        // "xml data from OTHER system" should NOT match "xml&(CB|AGV)"
        match3: w.ljDebug.msgMatches(
          "xml data from OTHER system",
          "xml&(CB|AGV)",
        ),
        // "json data from CB system" should NOT match "xml&(CB|AGV)"
        match4: w.ljDebug.msgMatches(
          "json data from CB system",
          "xml&(CB|AGV)",
        ),
      };
    });

    expect(results).not.toBeNull();
    expect(results?.match1).toBe(true);
    expect(results?.match2).toBe(true);
    expect(results?.match3).toBe(false);
    expect(results?.match4).toBe(false);
  });
});
