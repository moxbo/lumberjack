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
export interface CompiledDcFilterGroup {
  key: string;
  allowedValues: string[];
  candidates: string[];
  hasWildcard: boolean;
}

export type CompiledDcFilter = CompiledDcFilterGroup[];

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

export function compileDcFilter(
  dcEntries: ReadonlyArray<DcFilterEntry>,
): CompiledDcFilter {
  if (!dcEntries || dcEntries.length === 0) return [];

  const entriesByKey = new Map<string, string[]>();
  for (const entry of dcEntries) {
    if (!entry.active) continue;
    const key = canonicalDcKey(entry.key).toLowerCase();
    if (!key) continue;
    const values = entriesByKey.get(key) || [];
    values.push(String(entry.value ?? "").toLowerCase());
    entriesByKey.set(key, values);
  }

  const compiled: CompiledDcFilter = [];
  for (const [key, allowedValues] of entriesByKey) {
    compiled.push({
      key,
      allowedValues,
      candidates: eventKeyVariantsForCanonical(key),
      hasWildcard: allowedValues.includes(""),
    });
  }
  return compiled;
}

export function matchesCompiledDcFilter(
  mdc: Record<string, unknown> | null | undefined,
  compiled: CompiledDcFilter,
): boolean {
  if (compiled.length === 0) return true;
  if (!mdc || typeof mdc !== "object") return false;

  const hasOwn = (obj: Record<string, unknown>, k: string): boolean =>
    Object.prototype.hasOwnProperty.call(obj, k);

  for (const group of compiled) {
    const present: string[] = [];
    for (const candidate of group.candidates) {
      if (hasOwn(mdc, candidate)) {
        present.push(toSafeString(mdc[candidate]).toLowerCase());
      }
    }
    if (present.length === 0) {
      for (const key of Object.keys(mdc)) {
        if (key.toLowerCase() === group.key) {
          present.push(toSafeString(mdc[key]).toLowerCase());
        }
      }
    }

    if (group.hasWildcard && present.length > 0) continue;

    let keyMatched = false;
    for (const value of present) {
      if (group.allowedValues.includes(value)) {
        keyMatched = true;
        break;
      }
    }
    if (!keyMatched) return false;
  }

  return true;
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
  return matchesCompiledDcFilter(mdc, compileDcFilter(dcEntries));
}
