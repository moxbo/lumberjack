/**
 * Debug utilities for console access
 * Usage: window.ljDebug.findInEntries("searchterm")
 */

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
    findInEntries: (term: string) => {
      const entries = debugEntriesRef?.current || [];
      const filteredIdx = debugFilteredIdxRef?.current || [];
      const termLower = term.toLowerCase();

      // eslint-disable-next-line no-console
      console.log(
        "[ljDebug] Searching for '" +
          term +
          "' in " +
          entries.length +
          " total entries...",
      );

      const foundInAll: number[] = [];
      const foundInFiltered: number[] = [];

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e) continue;
        const msg = String(e.message || "").toLowerCase();
        const raw = JSON.stringify(e.raw || e).toLowerCase();

        if (msg.includes(termLower) || raw.includes(termLower)) {
          foundInAll.push(i);
          if (filteredIdx.includes(i)) {
            foundInFiltered.push(i);
          }
        }
      }

      // eslint-disable-next-line no-console
      console.log(
        "[ljDebug] Found " +
          foundInAll.length +
          " entries containing '" +
          term +
          "'",
      );
      // eslint-disable-next-line no-console
      console.log(
        "[ljDebug] Of those, " +
          foundInFiltered.length +
          " are visible (not filtered out)",
      );

      if (foundInAll.length > 0 && foundInFiltered.length === 0) {
        console.warn(
          "[ljDebug] WARNING: All " +
            foundInAll.length +
            " entries with '" +
            term +
            "' are filtered out!",
        );
        const firstIdx = foundInAll[0];
        if (firstIdx !== undefined) {
          // eslint-disable-next-line no-console
          console.log("[ljDebug] First matching entry:", entries[firstIdx]);
        }
      }

      return {
        total: foundInAll.length,
        visible: foundInFiltered.length,
        indices: foundInAll,
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
      // eslint-disable-next-line no-console
      console.log("[ljDebug] Top " + count + " largest messages:");
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
      console.log("[ljDebug] Entry statistics:", stats);
      return stats;
    },

    getFilterState: () => {
      // eslint-disable-next-line no-console
      console.log(
        "[ljDebug] Use window.ljDebug.findInEntries('searchterm') to search",
      );
      return "Check the filter toolbar in the app";
    },
  };
}
