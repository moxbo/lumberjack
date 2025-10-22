// Lightweight LoggingStore singleton for renderer-side event flow
// - addEvents(events): attaches event.mdc and notifies listeners
// - reset(): clears internal state and notifies listeners
// - addLoggingStoreListener(listener): { loggingEventsAdded(events), loggingStoreReset() }

const RESERVED_STD_FIELDS = new Set([
  'remarks',
  'color',
  'stack_trace',
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

function isString(v) {
  return typeof v === 'string';
}

function findExternalId(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const candidates = ['externalId', 'external_id', 'external.id', 'extId', 'traceparent', 'id'];
  for (const k of candidates) {
    const v = raw[k];
    if (isString(v) && v.trim()) return v.trim();
  }
  return null;
}

export function computeMdcFromRaw(raw) {
  const mdc = {};
  if (!raw || typeof raw !== 'object') return mdc;
  for (const [k, v] of Object.entries(raw)) {
    if (RESERVED_STD_FIELDS.has(k)) continue;
    if (!isString(v)) continue;
    const key = String(k);
    const val = String(v);
    if (!key.trim()) continue;
    mdc[key] = val;
  }
  const ext = findExternalId(raw);
  if (ext && !mdc.externalId) mdc.externalId = ext;
  return mdc;
}

class LoggingStoreImpl {
  constructor() {
    this._listeners = new Set();
    this._events = []; // optional, not strictly required for MDC
  }
  addLoggingStoreListener(listener) {
    if (listener && typeof listener === 'object') {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }
    return () => {};
  }
  addEvents(events) {
    if (!Array.isArray(events) || events.length === 0) return;
    for (const e of events) {
      try {
        // Attach MDC derived from raw JSON object
        const raw = e && (e.raw || e);
        e.mdc = computeMdcFromRaw(raw);
      } catch (_) {}
    }
    this._events.push(...events);
    for (const l of this._listeners) {
      try {
        l.loggingEventsAdded && l.loggingEventsAdded(events);
      } catch {}
    }
  }
  reset() {
    this._events = [];
    for (const l of this._listeners) {
      try {
        l.loggingStoreReset && l.loggingStoreReset();
      } catch {}
    }
  }
}

export const LoggingStore = new LoggingStoreImpl();
