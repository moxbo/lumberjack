// Lightweight LoggingStore singleton for renderer-side event flow
// - addEvents(events): attaches event.mdc and notifies listeners
// - reset(): clears internal state and notifies listeners
// - addLoggingStoreListener(listener): { loggingEventsAdded(events), loggingStoreReset() }

import { computeMdcFromRaw } from "../utils/mdc";
export { computeMdcFromRaw, findTraceId } from "../utils/mdc";

interface LogEvent {
  [k: string]: unknown;
  mdc?: Record<string, unknown>;
  raw?: unknown;
}

type Listener = {
  loggingEventsAdded?: (events: LogEvent[]) => void;
  loggingStoreReset?: () => void;
};

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
        e.mdc = computeMdcFromRaw({ ...rawObj, mdc: e.mdc ?? rawObj.mdc });
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
