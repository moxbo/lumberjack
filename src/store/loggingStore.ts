// Lightweight LoggingStore singleton for renderer-side event flow
// - addEvents(events): attaches event.mdc and notifies listeners
// - reset(): clears internal state and notifies listeners
// - addLoggingStoreListener(listener): { loggingEventsAdded(events), loggingStoreReset() }

interface LogEvent {
  [k: string]: unknown;
  mdc?: Record<string, string>;
  raw?: unknown;
}

type Listener = {
  loggingEventsAdded?: (events: LogEvent[]) => void;
  loggingStoreReset?: () => void;
};

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
  // additional common standard keys to avoid duplication in MDC
  "timestamp",
  "time",
  "logger",
  "thread",
  // trace id variants intentionally NOT excluded to show in MDC only
]);

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function findExternalId(raw: Record<string, unknown>): string | null {
  if (!raw || typeof raw !== "object") return null;
  const candidates = [
    "externalId",
    "external_id",
    "external.id",
    "extId",
    "traceparent",
    "id",
  ];
  for (const k of candidates) {
    const v = raw[k];
    if (isString(v) && v.trim()) return v.trim();
  }
  return null;
}

function findTraceId(raw: Record<string, unknown>): string | null {
  if (!raw || typeof raw !== "object") return null;
  const candidates = ["traceId", "trace_id", "trace", "trace.id", "TraceID"];
  for (const k of candidates) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
export { findTraceId };

// Trace-Key-Varianten als Modul-Konstante (Hot Path: wird pro Log-Event aufgerufen)
const TRACE_VARIANTS = new Set([
  "TraceID",
  "traceId",
  "trace_id",
  "trace.id",
  "trace-id",
  "x-trace-id",
  "x_trace_id",
  "x.trace.id",
  "trace",
]);

export function computeMdcFromRaw(
  raw: { [s: string]: unknown } | ArrayLike<unknown>,
): Record<string, string> {
  const mdc: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return mdc;
  // Zuerst TraceID extrahieren
  const tid = findTraceId(raw as Record<string, unknown>);
  // Übernahme aller string-basierten Felder außer reservierten und Trace-Varianten
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (RESERVED_STD_FIELDS.has(k)) continue;
    if (TRACE_VARIANTS.has(k)) continue;
    if (typeof v !== "string") continue;
    const key = String(k);
    const val = String(v);
    if (!key.trim()) continue;
    mdc[key] = val;
  }
  const ext = findExternalId(raw as Record<string, unknown>);
  if (ext && !mdc.externalId) mdc.externalId = ext;
  // Normalisierte TraceID im MDC nur unter dem kanonischen Key einmalig bereitstellen
  if (tid && !mdc.TraceID) mdc.TraceID = tid;
  return mdc;
}

class LoggingStoreImpl {
  private _listeners = new Set<Listener>();
  // Pure event-bus: events sind nicht mehr persistent gespeichert.
  // Die Entries werden bereits in useEntryManagement (entries-State) gehalten;
  // ein zweites paralleles Array hier verdoppelte den Renderer-Heap bei
  // großen Sessions (z. B. 300k Einträge). Konsumenten (z. B. MDCListener)
  // erhalten Events über loggingEventsAdded; ein Seeding-Snapshot wird nicht
  // mehr benötigt, da MDCListener.startListening() vor dem Eintreffen der
  // ersten Events in App.tsx aufgerufen wird.
  // Ein leerer Zähler ersetzt _events nur für Debug-Zwecke (getEventCount).
  private _eventCount = 0;

  addLoggingStoreListener(listener: Listener) {
    if (listener && typeof listener === "object") {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }
    return () => {};
  }
  /**
   * Liefert keinen Snapshot mehr, da der Store nun reiner Event-Bus ist.
   * Aus Kompatibilitätsgründen weiterhin verfügbar, gibt aber immer ein
   * leeres Array zurück. Konsumenten sollten Listener nutzen.
   */
  getAllEvents(): LogEvent[] {
    return [];
  }
  /**
   * Anzahl der jemals durchgeleiteten Events (nur Debug/Diagnose).
   */
  getEventCount(): number {
    return this._eventCount;
  }
  addEvents(events: LogEvent[]): void {
    if (!Array.isArray(events) || events.length === 0) return;
    for (const e of events) {
      try {
        // Attach MDC derived from raw JSON object
        const rawObj: Record<string, unknown> =
          e && e.raw && typeof e.raw === "object"
            ? (e.raw as Record<string, unknown>)
            : (e as Record<string, unknown>);
        e.mdc = computeMdcFromRaw(rawObj);
      } catch (err) {
        console.warn("computeMdcFromRaw failed:", err);
      }
    }

    this._eventCount += events.length;

    for (const l of this._listeners) {
      try {
        l.loggingEventsAdded?.(events);
      } catch (err) {
        console.warn("loggingEventsAdded listener failed:", err);
      }
    }
  }
  reset(): void {
    this._eventCount = 0;
    for (const l of this._listeners) {
      try {
        l.loggingStoreReset?.();
      } catch (err) {
        console.warn("loggingStoreReset listener failed:", err);
      }
    }
  }
}

import { lazyInstance } from "./_lazy";

/** Public interface for typed access (avoids `as any` casts in consumers) */
export interface ILoggingStore {
  addLoggingStoreListener(listener: Listener): () => void;
  /** @deprecated Store is a pure event-bus; returns always []. Use a listener instead. */
  getAllEvents(): LogEvent[];
  getEventCount(): number;
  addEvents(events: LogEvent[]): void;
  reset(): void;
}

// Export the singleton lazily to avoid temporal-dead-zone issues when modules
// import each other during initialization (bundlers can reorder/rename symbols).
export const LoggingStore: ILoggingStore = lazyInstance(
  () => new LoggingStoreImpl(),
);
