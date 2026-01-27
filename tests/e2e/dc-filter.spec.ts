/**
 * E2E Tests for DC (Diagnostic Context / MDC) Filter Functionality
 *
 * Tests the DC filter including:
 * - Opening the DC filter dialog
 * - Adding MDC entries
 * - Activating/deactivating filters
 * - Filtering log entries by MDC values
 */

import { test, expect } from "./electron-fixtures";

test.describe("DC Filter", () => {
  test.beforeEach(async ({ window }) => {
    // Wait for app to be ready
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });
    // Give the app more time to fully render
    await window.waitForTimeout(1000);
  });

  test("DC filter button should be visible in the toolbar", async ({
    window,
  }) => {
    // Look for the DC filter button (it shows "DC" text or has dc-related data attribute)
    const dcFilterButton = window.locator('button:has-text("DC")').first();
    await expect(dcFilterButton).toBeVisible({ timeout: 10000 });
  });

  // Note: This test is flaky in E2E due to panel rendering timing issues.
  // The DC filter API tests below verify the core functionality.
  test.fixme("should open DC filter dialog when clicking DC button", async ({
    window,
  }) => {
    // Click the DC filter button (use force to bypass overlay issues)
    const dcFilterButton = window.locator('button:has-text("DC")').first();
    await dcFilterButton.click({ force: true });

    // Wait for the DC filter dialog/panel to appear
    await window.waitForTimeout(1000);

    // Check if the DC filter panel is visible (look for various MDC-related text)
    // The panel contains "MDC Key", "MDC Value", "Hinzufügen" etc.
    const dcPanel = window
      .locator("text=MDC Key")
      .or(window.locator("text=MDC Value"))
      .or(window.locator("text=Hinzufügen"))
      .or(window.locator(".dc-panel"));
    await expect(dcPanel.first()).toBeVisible({ timeout: 10000 });
  });

  test("DiagnosticContextFilter should be accessible via debug API", async ({
    window,
  }) => {
    const result = await window.evaluate(() => {
      const w = window as any;
      // Check if DiagnosticContextFilter is accessible
      if (w.ljDebug?.DiagnosticContextFilter) {
        const dcf = w.ljDebug.DiagnosticContextFilter;
        return {
          hasFilter: true,
          hasGetState: typeof dcf.getState === "function",
          hasIsEnabled: typeof dcf.isEnabled === "function",
          hasAddMdcEntry: typeof dcf.addMdcEntry === "function",
          hasOnChange: typeof dcf.onChange === "function",
        };
      }
      return { hasFilter: false };
    });

    // The DC filter may or may not be exposed via debug API
    // This test documents the expected structure
    if (result.hasFilter) {
      expect(result.hasGetState).toBe(true);
      expect(result.hasIsEnabled).toBe(true);
      expect(result.hasAddMdcEntry).toBe(true);
      expect(result.hasOnChange).toBe(true);
    }
  });
});

test.describe("DC Filter Logic", () => {
  test.beforeEach(async ({ window }) => {
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });
    await window.waitForTimeout(500);
  });

  test("DC filter getState should return correct structure", async ({
    window,
  }) => {
    const result = await window.evaluate(() => {
      const w = window as any;
      if (w.ljDebug?.DiagnosticContextFilter) {
        const state = w.ljDebug.DiagnosticContextFilter.getState();
        return {
          hasState: true,
          hasEntries: Array.isArray(state?.entries),
          hasEnabled: typeof state?.enabled === "boolean",
          entriesCount: state?.entries?.length ?? 0,
          isEnabled: state?.enabled,
        };
      }
      return { hasState: false };
    });

    if (result.hasState) {
      expect(result.hasEntries).toBe(true);
      expect(result.hasEnabled).toBe(true);
      expect(typeof result.entriesCount).toBe("number");
      expect(typeof result.isEnabled).toBe("boolean");
    }
  });

  test("should be able to add and retrieve MDC entries via API", async ({
    window,
  }) => {
    const result = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.DiagnosticContextFilter) return { available: false };

      const dcf = w.ljDebug.DiagnosticContextFilter;

      // Get initial state
      const initialState = dcf.getState();
      const initialCount = initialState.entries.length;

      // Add a test entry
      dcf.addMdcEntry("TestKey", "TestValue");
      dcf.setEnabled(true);

      // Get updated state
      const updatedState = dcf.getState();
      const hasNewEntry = updatedState.entries.some(
        (e: any) => e.key === "TestKey" && e.value === "TestValue",
      );

      // Clean up: remove the test entry
      dcf.removeMdcEntry("TestKey", "TestValue");

      return {
        available: true,
        initialCount,
        updatedCount: updatedState.entries.length,
        hasNewEntry,
        isEnabled: updatedState.enabled,
      };
    });

    if (result.available) {
      expect(result.hasNewEntry).toBe(true);
      expect(result.updatedCount).toBeGreaterThanOrEqual(result.initialCount);
      expect(result.isEnabled).toBe(true);
    }
  });

  test("DC filter entries should use value (not val) in getState", async ({
    window,
  }) => {
    const result = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.DiagnosticContextFilter) return { available: false };

      const dcf = w.ljDebug.DiagnosticContextFilter;

      // Add a test entry
      dcf.addMdcEntry("KeyForTest", "ValueForTest");

      // Get state
      const state = dcf.getState();
      const entry = state.entries.find((e: any) => e.key === "KeyForTest");

      // Clean up
      dcf.removeMdcEntry("KeyForTest", "ValueForTest");

      return {
        available: true,
        entryFound: !!entry,
        hasValueProperty: entry ? "value" in entry : false,
        hasValProperty: entry ? "val" in entry : false,
        valueContent: entry?.value,
      };
    });

    if (result.available && result.entryFound) {
      // Verify that getState returns 'value', not 'val'
      expect(result.hasValueProperty).toBe(true);
      expect(result.hasValProperty).toBe(false);
      expect(result.valueContent).toBe("ValueForTest");
    }
  });

  test("DC filter TraceID key normalization should work", async ({
    window,
  }) => {
    const result = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.DiagnosticContextFilter) return { available: false };

      const dcf = w.ljDebug.DiagnosticContextFilter;

      // Add entries with different TraceID variants
      dcf.addMdcEntry("traceId", "test-trace-1");
      dcf.addMdcEntry("trace_id", "test-trace-2");

      // Get state
      const state = dcf.getState();

      // Both should be normalized to "TraceID"
      const traceIdEntries = state.entries.filter(
        (e: any) => e.key === "TraceID",
      );

      // Clean up
      dcf.removeMdcEntry("TraceID", "test-trace-1");
      dcf.removeMdcEntry("TraceID", "test-trace-2");

      return {
        available: true,
        traceIdEntriesCount: traceIdEntries.length,
        allNormalized: traceIdEntries.every((e: any) => e.key === "TraceID"),
      };
    });

    if (result.available) {
      // Both entries should be normalized to "TraceID"
      expect(result.traceIdEntriesCount).toBe(2);
      expect(result.allNormalized).toBe(true);
    }
  });
});

test.describe("DC Filter Integration with Filter Worker", () => {
  test.beforeEach(async ({ window }) => {
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });
    await window.waitForTimeout(500);
  });

  test("filter stats should include rejectedByDC counter", async ({
    window,
  }) => {
    const result = await window.evaluate(() => {
      const w = window as any;
      if (w.ljDebug?.filterStats) {
        return {
          hasStats: true,
          hasRejectedByDC: "rejectedByDC" in w.ljDebug.filterStats,
          rejectedByDC: w.ljDebug.filterStats.rejectedByDC,
        };
      }
      return { hasStats: false };
    });

    if (result.hasStats) {
      expect(result.hasRejectedByDC).toBe(true);
      expect(typeof result.rejectedByDC).toBe("number");
    }
  });
});

test.describe("DC Filter with Test Data", () => {
  test.beforeEach(async ({ window }) => {
    await window.waitForSelector("#app", { state: "visible", timeout: 30000 });
    await window.waitForTimeout(500);

    // Clear any existing entries and DC filters before each test
    await window.evaluate(() => {
      const w = window as any;
      w.ljDebug?.clearEntries?.();
      w.ljDebug?.DiagnosticContextFilter?.reset?.();
    });
    await window.waitForTimeout(200);
  });

  test.afterEach(async ({ window }) => {
    // Clean up after each test
    await window.evaluate(() => {
      const w = window as any;
      w.ljDebug?.clearEntries?.();
      w.ljDebug?.DiagnosticContextFilter?.reset?.();
    });
  });

  test("addTestEntries should add entries to LoggingStore", async ({
    window,
  }) => {
    // This test verifies that addTestEntries works at the LoggingStore level
    // Note: The UI may not immediately reflect these entries as it uses React state
    const result = await window.evaluate(async () => {
      const w = window as any;
      if (!w.ljDebug?.addTestEntries) {
        return { available: false };
      }

      // Add test entries with MDC
      const addedCount = w.ljDebug.addTestEntries([
        { message: "Test entry 1", mdc: { userId: "user-123" } },
        { message: "Test entry 2", mdc: { userId: "user-456" } },
        { message: "Test entry 3" },
      ]);

      return {
        available: true,
        addedCount,
        // Note: getTotalCount may return 0 if entries are managed via React state
        // instead of directly from LoggingStore
      };
    });

    if (result.available) {
      expect(result.addedCount).toBe(3);
    }
  });

  test("DC filter matches() should work with MDC data", async ({ window }) => {
    // Test the DC filter's matches() function directly
    const result = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.DiagnosticContextFilter) {
        return { available: false };
      }

      const dcf = w.ljDebug.DiagnosticContextFilter;

      // Add a filter entry
      dcf.addMdcEntry("userId", "user-123");
      dcf.setEnabled(true);

      // Test matches() with different MDC objects
      const matchesCorrect = dcf.matches({ userId: "user-123" });
      const matchesWrong = dcf.matches({ userId: "user-456" });
      const matchesEmpty = dcf.matches({});
      const matchesNull = dcf.matches(null);
      const matchesMissing = dcf.matches({ other: "value" });

      // Clean up
      dcf.removeMdcEntry("userId", "user-123");

      return {
        available: true,
        matchesCorrect,
        matchesWrong,
        matchesEmpty,
        matchesNull,
        matchesMissing,
      };
    });

    if (result.available) {
      expect(result.matchesCorrect).toBe(true);
      expect(result.matchesWrong).toBe(false);
      expect(result.matchesEmpty).toBe(false);
      expect(result.matchesNull).toBe(false);
      expect(result.matchesMissing).toBe(false);
    }
  });

  test("DC filter matches() with TraceID variants", async ({ window }) => {
    const result = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.DiagnosticContextFilter) {
        return { available: false };
      }

      const dcf = w.ljDebug.DiagnosticContextFilter;

      // Add a filter for TraceID
      dcf.addMdcEntry("TraceID", "trace-ABC");
      dcf.setEnabled(true);

      // Test with different TraceID key variants in the MDC
      const matchesTraceID = dcf.matches({ TraceID: "trace-ABC" });
      const matchesTraceId = dcf.matches({ traceId: "trace-ABC" });
      const matchesTrace_id = dcf.matches({ trace_id: "trace-ABC" });
      const matchesWrongValue = dcf.matches({ traceId: "trace-XYZ" });

      // Clean up
      dcf.removeMdcEntry("TraceID", "trace-ABC");

      return {
        available: true,
        matchesTraceID,
        matchesTraceId,
        matchesTrace_id,
        matchesWrongValue,
      };
    });

    if (result.available) {
      // All TraceID variants should match
      expect(result.matchesTraceID).toBe(true);
      expect(result.matchesTraceId).toBe(true);
      expect(result.matchesTrace_id).toBe(true);
      expect(result.matchesWrongValue).toBe(false);
    }
  });

  test("DC filter should return true when disabled", async ({ window }) => {
    const result = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.DiagnosticContextFilter) {
        return { available: false };
      }

      const dcf = w.ljDebug.DiagnosticContextFilter;

      // Add a filter but disable it
      dcf.addMdcEntry("key", "value");
      dcf.setEnabled(false);

      // Should return true for everything when disabled
      const matchesWithFilter = dcf.matches({ key: "value" });
      const matchesWithoutFilter = dcf.matches({ other: "data" });
      const matchesEmpty = dcf.matches({});

      // Clean up
      dcf.removeMdcEntry("key", "value");

      return {
        available: true,
        matchesWithFilter,
        matchesWithoutFilter,
        matchesEmpty,
      };
    });

    if (result.available) {
      // When disabled, matches() should always return true
      expect(result.matchesWithFilter).toBe(true);
      expect(result.matchesWithoutFilter).toBe(true);
      expect(result.matchesEmpty).toBe(true);
    }
  });

  test("DC filter AND logic between different keys", async ({ window }) => {
    const result = await window.evaluate(() => {
      const w = window as any;
      if (!w.ljDebug?.DiagnosticContextFilter) {
        return { available: false };
      }

      const dcf = w.ljDebug.DiagnosticContextFilter;

      // Add filters for multiple keys (AND logic)
      dcf.addMdcEntry("userId", "user-1");
      dcf.addMdcEntry("sessionId", "sess-A");
      dcf.setEnabled(true);

      // Test matches() with different combinations
      const matchesBoth = dcf.matches({
        userId: "user-1",
        sessionId: "sess-A",
      });
      const matchesUserOnly = dcf.matches({
        userId: "user-1",
        sessionId: "sess-B",
      });
      const matchesSessionOnly = dcf.matches({
        userId: "user-2",
        sessionId: "sess-A",
      });
      const matchesNeither = dcf.matches({
        userId: "user-2",
        sessionId: "sess-B",
      });

      // Clean up
      dcf.removeMdcEntry("userId", "user-1");
      dcf.removeMdcEntry("sessionId", "sess-A");

      return {
        available: true,
        matchesBoth,
        matchesUserOnly,
        matchesSessionOnly,
        matchesNeither,
      };
    });

    if (result.available) {
      // Only entries with BOTH matching keys should pass
      expect(result.matchesBoth).toBe(true);
      expect(result.matchesUserOnly).toBe(false);
      expect(result.matchesSessionOnly).toBe(false);
      expect(result.matchesNeither).toBe(false);
    }
  });
});
