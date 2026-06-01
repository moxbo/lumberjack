// Shared, dependency-free DC/MDC matching logic.
//
// Single source of truth for filtering log entries by their Diagnostic
// Context (MDC). Used by:
// - src/store/dcFilter.ts (renderer reference implementation)
// - src/main/filterProcess.ts (Electron UtilityProcess)
// - src/workers/filterWorker.ts (Web Worker)
// - src/hooks/useFilterWorker.ts (synchronous fallback)
//
// Matching semantics:
// - OR within the same (canonical) key, e.g. TraceID=A OR TraceID=B
// - AND across different keys
// - Empty value ("") acts as a wildcard: the key only needs to be present
// - Trace key variants (traceId, trace_id, trace.id, ...) are normalized to
//   the canonical "TraceID" so a single filter entry matches all spellings.

export type DcFilterEntry = { key: string; value: string; active: boolean };

// Map diverse trace-key spellings to the canonical display/filter name.
const TRACE_KEY_VARIANTS = new Set([
  "traceid",
  "trace_id",
  "trace.id",
  "trace-id",
  "x-trace-id",
  "x_trace_id",
  "x.trace.id",
  "trace",
]);

export function normalizeTraceKeyName(k: string): string | null {
  const lk = String(k || "")
    .trim()
    .toLowerCase();
  return TRACE_KEY_VARIANTS.has(lk) ? "TraceID" : null;
}

// Canonical DC key used for display and filtering.
export function canonicalDcKey(k: string): string {
  const raw = String(k || "").trim();
  if (!raw) return "";
  return normalizeTraceKeyName(raw) || raw;
}

// All event-key spellings that map to a given canonical key.
export function eventKeyVariantsForCanonical(k: string): string[] {
  const canon = normalizeTraceKeyName(k) || String(k || "").trim();
  if (canon === "TraceID") {
    return [
      "TraceID",
      "traceId",
      "trace_id",
      "trace.id",
      "trace-id",
      "x-trace-id",
      "x_trace_id",
      "x.trace.id",
      "trace",
    ];
  }
  return [canon];
}

// Safe, deterministic string coercion for arbitrary MDC values.
export function toSafeString(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (
    typeof val === "number" ||
    typeof val === "boolean" ||
    typeof val === "bigint"
  ) {
    return String(val);
  }
  if (typeof val === "object" || typeof val === "function") {
    try {
      return JSON.stringify(val);
    } catch {
      return "";
    }
  }
  // symbol/unknown
  return "";
}

/**
 * Returns true if the given MDC matches the (active) DC filter entries.
 *
 * - OR within the same canonical key, AND across different keys.
 * - Empty value is a wildcard (key must merely be present).
 * - Matching is case-insensitive and trace-variant aware.
 */
export function matchesDcFilter(
  mdc: Record<string, unknown> | null | undefined,
  dcEntries: ReadonlyArray<DcFilterEntry>,
): boolean {
  if (!dcEntries || dcEntries.length === 0) return true;

  const activeEntries = dcEntries.filter((e) => e.active);
  if (activeEntries.length === 0) return true;

  if (!mdc || typeof mdc !== "object") return false;

  // Group entry values by canonical key (lowercased for comparison).
  const entriesByKey = new Map<string, string[]>();
  for (const entry of activeEntries) {
    const key = canonicalDcKey(entry.key).toLowerCase();
    if (!key) continue;
    const values = entriesByKey.get(key) || [];
    values.push(String(entry.value ?? "").toLowerCase());
    entriesByKey.set(key, values);
  }

  const hasOwn = (obj: Record<string, unknown>, k: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, k);

  // For each key group: at least one value (or a wildcard) must match.
  for (const [key, allowedValues] of entriesByKey) {
    // Collect all present event values across canonical key variants.
    const present: string[] = [];
    const candidates = eventKeyVariantsForCanonical(key);
    for (const cand of candidates) {
      if (hasOwn(mdc, cand)) {
        present.push(toSafeString(mdc[cand]).toLowerCase());
      }
    }
    // Fallback: also match by case-insensitive key comparison so that
    // arbitrary spellings (e.g. differing case) still work.
    if (present.length === 0) {
      for (const k of Object.keys(mdc)) {
        if (k.toLowerCase() === key) {
          present.push(toSafeString(mdc[k]).toLowerCase());
        }
      }
    }

    const hasWildcard = allowedValues.includes("");
    let keyMatched = false;
    if (hasWildcard && present.length > 0) {
      keyMatched = true;
    } else {
      for (const val of present) {
        if (allowedValues.includes(val)) {
          keyMatched = true;
          break;
        }
      }
    }

    if (!keyMatched) return false;
  }

  return true;
}
