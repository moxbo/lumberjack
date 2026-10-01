import { canonicalDcKey, toSafeString } from "./dcMatch";

const RESERVED_STD_FIELDS = new Set([
  "remarks",
  "color",
  "stack_trace",
  "stackTrace",
  "stacktrace",
  "error",
  "err",
  "exception",
  "cause",
  "throwable",
  "exception.stacktrace",
  "error.stacktrace",
  "level",
  "thread_name",
  "logger_name",
  "message",
  "@timestamp",
  "@version",
  "timestamp",
  "time",
  "logger",
  "thread",
  "_fullMessage",
  "_truncated",
  "_messageSize",
  "source",
  "signature",
  "_id",
  "_mark",
  "raw",
]);

const CONTEXT_FIELDS = new Set(["mdc", "context", "properties", "labels"]);

export function findTraceId(raw: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(raw)) {
    if (
      canonicalDcKey(key) === "TraceID" &&
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }
  return null;
}

function findExternalId(raw: Record<string, unknown>): string | null {
  for (const key of [
    "externalId",
    "external_id",
    "external.id",
    "extId",
    "traceparent",
    "id",
  ]) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function computeMdcFromRaw(
  raw: { [s: string]: unknown } | ArrayLike<unknown>,
): Record<string, string> {
  const mdc: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return mdc;
  const add = (key: string, value: unknown) => {
    const canonical = canonicalDcKey(key);
    if (!canonical || value == null) return;
    Object.defineProperty(mdc, canonical, {
      value: toSafeString(value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  };
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED_STD_FIELDS.has(key) || CONTEXT_FIELDS.has(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      add(key, value);
    }
  }
  const record = raw as Record<string, unknown>;
  const externalId = findExternalId(record);
  if (externalId && !mdc.externalId) add("externalId", externalId);
  const traceId = findTraceId(record);
  if (traceId) add("TraceID", traceId);
  // Explicit context wins over top-level fields; mdc has the highest priority.
  for (const field of ["labels", "properties", "context", "mdc"]) {
    const context = record[field];
    if (context && typeof context === "object" && !Array.isArray(context)) {
      for (const [key, value] of Object.entries(context)) add(key, value);
    }
  }
  return mdc;
}
