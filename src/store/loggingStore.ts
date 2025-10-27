// Lightweight LoggingStore singleton for renderer-side event flow
// - addEvents(events): attaches event.mdc and notifies listeners
// - reset(): clears internal state and notifies listeners
// - addLoggingStoreListener(listener): { loggingEventsAdded(events), loggingStoreReset() }

type Listener = {
  loggingEventsAdded?: (events: any[]) => void;
  loggingStoreReset?: () => void;
};

const RESERVED_STD_FIELDS = new Set([
  'remarks',
  'color',
  'stack_trace',
  'stackTrace',
  'stacktrace',
  'error',
  'err',
  'exception',
  'cause',
  'throwable',
  'exception.stacktrace',
  'error.stacktrace',
  'level',
  'thread_name',
  'logger_name',
  'message',
  '@timestamp',
  '@version',
  // additional common standard keys to avoid duplication in MDC
  'timestamp',
  'time',
  'logger',
  'thread',
  // trace id variants intentionally NOT excluded to show in MDC only
]);

function isString(v: unknown) {
  return typeof v === 'string';
}

function findExternalId(raw: { [x: string]: any }) {
  if (!raw || typeof raw !== 'object') return null;
  const candidates = ['externalId', 'external_id', 'external.id', 'extId', 'traceparent', 'id'];
  for (const k of candidates) {
    const v = raw[k];
    if (isString(v) && v.trim()) return v.trim();
  }
  return null;
}

function findTraceId(raw: { [x: string]: any }) {
  if (!raw || typeof raw !== 'object') return null;
  const candidates = ['traceId', 'trace_id', 'trace', 'trace.id', 'TraceID'];
  for (const k of candidates) {
    const v = raw[k];
    if (isString(v) && v.trim()) return v.trim();
  }
  return null;
}

export function computeMdcFromRaw(raw: { [s: string]: unknown } | ArrayLike<unknown>) {
  const mdc: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return mdc;
  for (const [k, v] of Object.entries(raw)) {
    if (RESERVED_STD_FIELDS.has(k)) continue;
    if (!isString(v)) continue;
    const key = String(k);
    const val = String(v);
    if (!key.trim()) continue;
    mdc[key] = val;
  }
  const ext = findExternalId(raw as any);
  if (ext && !mdc.externalId) mdc.externalId = ext;
  // Normalisierte TraceId zusätzlich bereitstellen, um MDC-Filterung über einen Key zu ermöglichen
  const tid = findTraceId(raw as any);
  if (tid && !mdc.traceId) mdc.traceId = tid;
  return mdc;
}

class LoggingStoreImpl {
  private _listeners = new Set<Listener>();
  private _events: any[] = [];
  addLoggingStoreListener(listener: Listener) {
    if (listener && typeof listener === 'object') {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }
    return () => {};
  }
  addEvents(events: any[]): void {
    if (!Array.isArray(events) || events.length === 0) return;
    for (const e of events) {
      try {
        // Attach MDC derived from raw JSON object
        const raw = e && (e.raw || e);
        e.mdc = computeMdcFromRaw(raw);
      } catch (err) {
        console.warn('computeMdcFromRaw failed:', err);
      }
    }
    this._events.push(...events);
    for (const l of this._listeners) {
      try {
        l.loggingEventsAdded && l.loggingEventsAdded(events);
      } catch (err) {
        console.warn('loggingEventsAdded listener failed:', err);
      }
    }
  }
  reset(): void {
    this._events = [];
    for (const l of this._listeners) {
      try {
        l.loggingStoreReset && l.loggingStoreReset();
      } catch (err) {
        console.warn('loggingStoreReset listener failed:', err);
      }
    }
  }
}

import { lazyInstance } from './_lazy';

// Export the singleton lazily to avoid temporal-dead-zone issues when modules
// import each other during initialization (bundlers can reorder/rename symbols).
export const LoggingStore = lazyInstance(() => new LoggingStoreImpl());
