import { useState, useCallback, useRef } from "preact/hooks";

interface MDCPair {
  key: string;
  value: string;
}

interface UseLazyMDCResult {
  mdcPairs: MDCPair[];
  isLoading: boolean;
  loadMDC: (entry: unknown) => void;
  clearMDC: () => void;
}

// Canonical key mapping for common MDC variants
const CANONICAL_KEYS: Record<string, string> = {
  traceid: "TraceID",
  trace_id: "TraceID",
  "trace.id": "TraceID",
  "trace-id": "TraceID",
  "x-trace-id": "TraceID",
  spanid: "SpanID",
  span_id: "SpanID",
  "span.id": "SpanID",
  requestid: "RequestID",
  request_id: "RequestID",
  "request.id": "RequestID",
  correlationid: "CorrelationID",
  correlation_id: "CorrelationID",
  "correlation.id": "CorrelationID",
  sessionid: "SessionID",
  session_id: "SessionID",
  "session.id": "SessionID",
  userid: "UserID",
  user_id: "UserID",
  "user.id": "UserID",
};

function canonicalKey(key: string): string {
  const lower = key.toLowerCase();
  return CANONICAL_KEYS[lower] || key;
}

/**
 * Hook for lazy loading MDC data.
 * MDC data is only processed when an entry is selected.
 */
export function useLazyMDC(): UseLazyMDCResult {
  const [mdcPairs, setMdcPairs] = useState<MDCPair[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const processingRef = useRef<number>(0);

  const loadMDC = useCallback((entry: unknown) => {
    const requestId = Date.now();
    processingRef.current = requestId;

    if (!entry) {
      setMdcPairs([]);
      setIsLoading(false);
      return;
    }

    const entryObj = entry as Record<string, unknown>;
    const mdc = entryObj.mdc as Record<string, unknown> | undefined;

    if (!mdc || typeof mdc !== "object") {
      setMdcPairs([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Use requestIdleCallback for non-blocking processing
    const processId = requestIdleCallback(
      () => {
        // Check if this request is still current
        if (processingRef.current !== requestId) return;

        try {
          // Group by canonical key and deduplicate values
          const byKey = new Map<string, Set<string>>();

          for (const [k, v] of Object.entries(mdc)) {
            const ck = canonicalKey(k);
            if (!ck) continue;

            const val = v == null ? "" : String(v);

            if (!byKey.has(ck)) {
              byKey.set(ck, new Set());
            }
            byKey.get(ck)!.add(val);
          }

          // Convert to pairs array
          const pairs: MDCPair[] = [];
          for (const [k, set] of byKey.entries()) {
            const vals = Array.from(set)
              .filter((s) => s !== "")
              .sort();
            const hasEmpty = set.has("");
            const joined = vals.join(" | ");
            pairs.push({
              key: k,
              value: hasEmpty && !joined ? "" : joined,
            });
          }

          // Sort by key
          pairs.sort((a, b) => a.key.localeCompare(b.key));

          // Check again if this request is still current
          if (processingRef.current === requestId) {
            setMdcPairs(pairs);
            setIsLoading(false);
          }
        } catch (error) {
          console.error("[useLazyMDC] Error processing MDC:", error);
          if (processingRef.current === requestId) {
            setMdcPairs([]);
            setIsLoading(false);
          }
        }
      },
      { timeout: 100 },
    );

    return () => {
      cancelIdleCallback(processId);
    };
  }, []);

  const clearMDC = useCallback(() => {
    processingRef.current = 0;
    setMdcPairs([]);
    setIsLoading(false);
  }, []);

  return {
    mdcPairs,
    isLoading,
    loadMDC,
    clearMDC,
  };
}
