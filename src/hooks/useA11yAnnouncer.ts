/**
 * Hook for aggregated aria-live announcements of incoming logs.
 *
 * QW-11 / A11Y-3: Screen readers receive a debounced summary like
 * "+12 INFO, +1 ERROR" every ~2s instead of one announcement per append.
 */
import { useCallback, useRef, useState } from "preact/hooks";

export interface UseA11yAnnouncerReturn {
  /** Latest aggregated announcement string for the aria-live region. */
  a11yAnnouncement: string;
  /** Feed newly appended entries into the debounced announcer. */
  announceAppend: (
    newEntries: ReadonlyArray<{ level?: string | null }> | undefined,
  ) => void;
}

export function useA11yAnnouncer(): UseA11yAnnouncerReturn {
  const [a11yAnnouncement, setA11yAnnouncement] = useState<string>("");
  const a11yPendingRef = useRef<Record<string, number>>({});
  const a11yTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announceAppend = useCallback(
    (newEntries: ReadonlyArray<{ level?: string | null }> | undefined) => {
      if (!newEntries || newEntries.length === 0) return;
      const pend = a11yPendingRef.current;
      for (const e of newEntries) {
        const lvl = (e?.level || "OTHER").toString().toUpperCase();
        pend[lvl] = (pend[lvl] || 0) + 1;
      }
      if (a11yTimerRef.current) return;
      a11yTimerRef.current = setTimeout(() => {
        a11yTimerRef.current = null;
        const counts = a11yPendingRef.current;
        a11yPendingRef.current = {};
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total === 0) return;
        const summary = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([lvl, n]) => `+${n} ${lvl}`)
          .join(", ");
        setA11yAnnouncement(`${total} – ${summary}`);
      }, 2000);
    },
    [],
  );

  return { a11yAnnouncement, announceAppend };
}
