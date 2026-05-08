/**
 * Debug utilities for console access
 * Usage: window.ljDebug.findInEntries("searchterm")
 */

import { getRendererLogEntryPool } from "../store/RendererLogEntryPool";
import { LoggingStore } from "../store/loggingStore";
import { DiagnosticContextFilter } from "../store/dcFilter";
import { msgMatches as msgMatchesFn } from "./msgFilter";

// Global debug reference for console access
let debugEntriesRef: { current: any[] } | null = null;
let debugFilteredIdxRef: { current: number[] } | null = null;

export function setDebugEntriesRef(ref: { current: any[] } | null): void {
  debugEntriesRef = ref;
}

export function setDebugFilteredIdxRef(
  ref: { current: number[] } | null,
): void {
  debugFilteredIdxRef = ref;
}

export function setupDebugFunctions(): void {
  (window as any).ljDebug = {
    /**
     * Search for a term in log entries.
     * By default, searches only in filtered (visible) entries for better performance.
     * @param term - The search term
     * @param searchAll - If true, search all entries (not just filtered). Default: false
     */
    findInEntries: (term: string, searchAll = false) => {
      const entries = debugEntriesRef?.current || [];
      const filteredIdx = debugFilteredIdxRef?.current || [];
      const termLower = term.toLowerCase();

      const isFilterActive = filteredIdx.length < entries.length;
      const searchScope = searchAll ? entries.length : filteredIdx.length;

      console.log(
        "[ljDebug] Searching for '" +
          term +
          "' in " +
          searchScope +
          (searchAll ? " total" : " filtered") +
          " entries" +
          (isFilterActive && !searchAll
            ? " (filter active, use findInEntries(term, true) to search all)"
            : "") +
          "...",
      );

      const found: number[] = [];

      if (searchAll) {
        // Search all entries
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (!e) continue;
          const msg = String(e.message || "").toLowerCase();
          const raw = JSON.stringify(e.raw || e).toLowerCase();

          if (msg.includes(termLower) || raw.includes(termLower)) {
            found.push(i);
          }
        }
      } else {
        // Search only filtered entries (more performant)
        for (const idx of filteredIdx) {
          const e = entries[idx];
          if (!e) continue;
          const msg = String(e.message || "").toLowerCase();
          const raw = JSON.stringify(e.raw || e).toLowerCase();

          if (msg.includes(termLower) || raw.includes(termLower)) {
            found.push(idx);
          }
        }
      }

      console.log(
        "[ljDebug] Found " +
          found.length +
          " entries containing '" +
          term +
          "'" +
          (searchAll && isFilterActive
            ? " (of which " +
              found.filter((i) => filteredIdx.includes(i)).length +
              " are visible)"
            : ""),
      );

      if (found.length === 0 && !searchAll && isFilterActive) {
        console.log(
          "[ljDebug] Tip: No matches in filtered entries. Try findInEntries('" +
            term +
            "', true) to search all entries.",
        );
      }

      return {
        count: found.length,
        indices: found,
        searchedAll: searchAll,
        filterActive: isFilterActive,
      };
    },

    largestMessages: (count = 10) => {
      const entries = debugEntriesRef?.current || [];
      const sized = entries.map((e, i) => ({
        index: i,
        size: new TextEncoder().encode(String(e?.message || "")).length,
        timestamp: e?.timestamp,
        logger: e?.logger,
        level: e?.level,
        messagePreview: String(e?.message || "").substring(0, 100),
      }));
      sized.sort((a, b) => b.size - a.size);
      const top = sized.slice(0, count);
      console.log("[ljDebug] Top " + count + " largest messages:");
      console.table(top);
      return top;
    },

    stats: () => {
      const entries = debugEntriesRef?.current || [];
      const filteredIdx = debugFilteredIdxRef?.current || [];
      const totalSize = entries.reduce(
        (sum, e) =>
          sum + new TextEncoder().encode(String(e?.message || "")).length,
        0,
      );
      const levels: Record<string, number> = {};
      entries.forEach((e) => {
        const lvl = String(e?.level || "UNKNOWN").toUpperCase();
        levels[lvl] = (levels[lvl] || 0) + 1;
      });
      const stats = {
        totalEntries: entries.length,
        filteredEntries: filteredIdx.length,
        hiddenEntries: entries.length - filteredIdx.length,
        totalMessageSize: (totalSize / 1024 / 1024).toFixed(2) + " MB",
        levelCounts: levels,
      };
      console.log("[ljDebug] Entry statistics:", stats);
      return stats;
    },

    getFilterState: () => {
      console.log(
        "[ljDebug] Use window.ljDebug.findInEntries('searchterm') to search",
      );
      return "Check the filter toolbar in the app";
    },

    poolStats: () => {
      const pool = getRendererLogEntryPool();
      const stats = pool.getStats();
      console.log("[ljDebug] LogEntry Pool Statistics:");
      console.log("  Available in pool: " + stats.available);
      console.log("  Total created: " + stats.totalCreated);
      console.log("  Reused: " + stats.reused);
      console.log("  Returned: " + stats.returned);
      console.log("  Hit rate: " + (stats.hitRate * 100).toFixed(1) + "%");
      console.log("  Max size: " + stats.maxSize);
      return stats;
    },

    memoryUsage: () => {
      const entries = debugEntriesRef?.current || [];
      const pool = getRendererLogEntryPool();
      const poolStats = pool.getStats();

      // Estimate memory usage
      let totalStringSize = 0;
      let mdcCount = 0;
      let stackTraceCount = 0;

      entries.forEach((e) => {
        if (e?.message) totalStringSize += e.message.length * 2; // UTF-16
        if (e?.logger) totalStringSize += e.logger.length * 2;
        if (e?.timestamp) totalStringSize += e.timestamp.length * 2;
        if (e?.stackTrace) {
          totalStringSize += e.stackTrace.length * 2;
          stackTraceCount++;
        }
        if (e?.mdc && Object.keys(e.mdc).length > 0) {
          mdcCount++;
          Object.entries(e.mdc).forEach(([k, v]) => {
            totalStringSize += (k.length + String(v).length) * 2;
          });
        }
      });

      const estimatedMB = (totalStringSize / 1024 / 1024).toFixed(2);
      const avgPerEntry = entries.length
        ? (totalStringSize / entries.length).toFixed(0)
        : 0;

      const report = {
        entries: entries.length,
        estimatedStringMemory: estimatedMB + " MB",
        averageBytesPerEntry: avgPerEntry + " bytes",
        entriesWithMDC: mdcCount,
        entriesWithStackTrace: stackTraceCount,
        pool: {
          available: poolStats.available,
          hitRate: (poolStats.hitRate * 100).toFixed(1) + "%",
          reused: poolStats.reused,
        },
      };

      console.log("[ljDebug] Memory Usage Estimate:", report);
      return report;
    },

    /**
     * Test the msgMatches function directly.
     * Useful for debugging filter expressions.
     * @example window.ljDebug.msgMatches("Tom&Jerry", "Tom\\&Jerry") // true
     */
    msgMatches: (message: string, expr: string, mode?: string) => {
      return msgMatchesFn(
        message,
        expr,
        mode ? { mode: mode as any } : undefined,
      );
    },

    /**
     * Add test log entries for E2E testing.
     * @param entries Array of {message, level?, logger?, mdc?} objects
     * @example window.ljDebug.addTestEntries([{message: "Test", mdc: {userId: "123"}}])
     */
    addTestEntries: (
      entries: Array<{
        message: string;
        level?: string;
        logger?: string;
        thread?: string;
        mdc?: Record<string, string>;
      }>,
    ) => {
      const now = new Date().toISOString();
      const logEvents = entries.map((e, i) => ({
        timestamp: now,
        level: e.level || "INFO",
        logger: e.logger || "test.logger",
        thread: e.thread || "test-thread",
        message: e.message,
        traceId: null,
        stackTrace: null,
        mdc: e.mdc || null,
        raw: { message: e.message, mdc: e.mdc },
        source: "test://e2e-test",
        _testId: `test-${Date.now()}-${i}`,
      }));
      (LoggingStore as any).addEvents(logEvents);
      console.log(`[ljDebug] Added ${logEvents.length} test entries`);
      return logEvents.length;
    },

    /**
     * Clear all log entries (for test cleanup).
     */
    clearEntries: () => {
      (LoggingStore as any).reset();
      console.log("[ljDebug] Cleared all entries");
    },

    /**
     * Get the count of currently visible (filtered) entries.
     */
    getVisibleCount: () => {
      return debugFilteredIdxRef?.current?.length || 0;
    },

    /**
     * Get the total count of entries.
     */
    getTotalCount: () => {
      // Try debugEntriesRef first, then fall back to LoggingStore-Counter.
      // (LoggingStore hält keine Events mehr persistent; getEventCount liefert
      // die Anzahl der durchgeleiteten Events seit dem letzten reset.)
      const refCount = debugEntriesRef?.current?.length || 0;
      if (refCount > 0) return refCount;
      try {
        return (LoggingStore as any).getEventCount?.() || 0;
      } catch {
        return 0;
      }
    },

    /**
     * Access to DiagnosticContextFilter for E2E testing.
     * Allows testing DC filter functionality:
     * - getState(): Get current filter entries and enabled state
     * - isEnabled(): Check if filter is enabled
     * - addMdcEntry(key, val): Add a filter entry
     * - removeMdcEntry(key, val): Remove a filter entry
     * - setEnabled(bool): Enable/disable the filter
     * - reset(): Clear all filter entries
     */
    DiagnosticContextFilter,
  };
}
