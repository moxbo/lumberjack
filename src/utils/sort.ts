// Generic sorting helpers for log entries
// compareByTimestampId: ascending by timestamp with sub-millisecond precision if available; ties and invalid timestamps by _id

function extractFractionBeyondMs(ts: unknown): number {
  // Extract digits after the decimal point in the seconds field, beyond the first 3 (milliseconds)
  // Example: 2025-10-23T15:46:12.0493117+02:00 -> fracAll=0493117 -> beyondMs=3117 -> normalized to 6 digits
  // Also handles space-separated format: 2025-12-11 18:49:41.278
  try {
    if (ts == null || (typeof ts !== "string" && typeof ts !== "number"))
      return 0;
    const s = String(ts);
    // Match both T-separated (ISO) and space-separated timestamp formats
    const m = s.match(/[T ]\d{2}:\d{2}:\d{2}\.(\d+)/);
    if (!m) return 0;
    const frac = m[1] || "";
    if (!frac) return 0;
    const beyond = frac.length > 3 ? frac.slice(3) : "";
    if (!beyond) return 0;
    // Normalize to 6 digits (microseconds part beyond ms) for comparable precision without BigInt
    const norm = (beyond + "000000").slice(0, 6); // padEnd to 6, then cut to 6
    const num = Number(norm);
    return Number.isFinite(num) ? num : 0;
  } catch {
    return 0;
  }
}

function toMillisEx(ts: unknown): {
  valid: boolean;
  ms: number;
  extra: number;
} {
  if (ts == null) return { valid: false, ms: NaN, extra: 0 };
  try {
    // Ensure ts is a valid Date constructor argument
    const dateArg =
      typeof ts === "string" || typeof ts === "number" ? ts : String(ts);
    const d = new Date(dateArg);
    const ms = d.getTime();
    if (!Number.isFinite(ms)) return { valid: false, ms: NaN, extra: 0 };
    const extra = extractFractionBeyondMs(ts);
    return { valid: true, ms, extra };
  } catch {
    return { valid: false, ms: NaN, extra: 0 };
  }
}

export function compareByTimestampId(
  a: { timestamp?: unknown; _id?: number; message?: string },
  b: { timestamp?: unknown; _id?: number; message?: string },
): number {
  const A = toMillisEx(a?.timestamp);
  const B = toMillisEx(b?.timestamp);
  if (A.valid && B.valid) {
    if (A.ms !== B.ms) return A.ms - B.ms;
    if (A.extra !== B.extra) return A.extra - B.extra;
  } else if (A.valid && !B.valid) {
    // valid timestamps come before invalid/missing ones
    return -1;
  } else if (!A.valid && B.valid) {
    return 1;
  }
  // tie-breaker: stable by _id if present
  const ai = a?._id ?? 0;
  const bi = b?._id ?? 0;
  if (ai !== bi) return ai - bi;
  // final tie-breaker: by message to keep deterministic order
  const am = String(a?.message ?? "");
  const bm = String(b?.message ?? "");
  return am.localeCompare(bm);
}
