// MDCListener: sammelt bekannte MDC-Schlüssel und Werte aus dem LoggingStore
// keys: Map<string, Set<string>>; hält interne Sortierung nicht, liefert aber sortierte Arrays per Getter

import { lazyInstance } from "./_lazy";
import { canonicalDcKey } from "./dcFilter";

type Listener = () => void;
class SimpleEmitter {
  private _ls = new Set<Listener>();
  on(fn: Listener) {
    if (typeof fn === "function") {
      this._ls.add(fn);
      return () => this._ls.delete(fn);
    }
    return () => {};
  }
  emit(): void {
    for (const fn of this._ls) {
      try {
        fn();
      } catch (e) {
        console.warn("MDCListener emitter listener error:", e);
      }
    }
  }
}

class MDCListenerImpl {
  private _started = false;
  private _em = new SimpleEmitter();
  public keys = new Map<string, Set<string>>(); // key -> Set(values)
  // Memory limits to prevent unbounded growth
  private static readonly MAX_KEYS = 1000;
  private static readonly MAX_VALUES_PER_KEY = 10000;
  // No automatic subscription here. Call startListening() from app startup
  // (e.g. in App.jsx) to wire this listener after modules are initialized.

  startListening(): void {
    try {
      // guard: multiple calls should not add duplicate listeners
      if (this._started) return;
      this._started = true;
      // Load LoggingStore dynamically to avoid a static circular import
      import("./loggingStore")
        .then((mod) => {
          const modAny = mod as {
            LoggingStore?: {
              addLoggingStoreListener: (listener: unknown) => void;
              getAllEvents?: () => Array<Record<string, unknown>>;
            };
            default?: {
              addLoggingStoreListener: (listener: unknown) => void;
              getAllEvents?: () => Array<Record<string, unknown>>;
            };
          };
          const LS = modAny?.LoggingStore || modAny?.default;
          try {
            // Seed with existing events (if any)
            try {
              const all = LS?.getAllEvents?.() || [];
              if (Array.isArray(all) && all.length) this._onAdded(all);
            } catch (e) {
              console.warn("MDCListener seeding failed:", e);
            }
            LS?.addLoggingStoreListener({
              loggingEventsAdded: (events: Record<string, unknown>[]) =>
                this._onAdded(events),
              loggingStoreReset: () => this._onReset(),
            });
          } catch (e) {
            console.warn("Failed to attach LoggingStore listener:", e);
          }
        })
        .catch((e) => {
          console.warn("Dynamic import of LoggingStore failed:", e);
        });
    } catch (e) {
      console.warn("startListening failed:", e);
    }
  }

  private _onReset(): void {
    this.keys.clear();
    this._em.emit();
  }
  private _onAdded(events: Array<Record<string, unknown>>): void {
    let changed = false;
    for (const e of events || []) {
      const obj = e;
      const mdc = (obj && (obj["mdc"] as Record<string, unknown>)) || {};
      for (const [k, v] of Object.entries(mdc)) {
        const ck = canonicalDcKey(k);
        if (!ck || typeof v !== "string") continue;

        // Check key limit
        if (!this.keys.has(ck)) {
          if (this.keys.size >= MDCListenerImpl.MAX_KEYS) {
            // Skip new keys when at limit
            continue;
          }
          this.keys.set(ck, new Set());
          changed = true;
        }

        const set = this.keys.get(ck)!;
        if (!set.has(v)) {
          // Check value limit per key
          if (set.size >= MDCListenerImpl.MAX_VALUES_PER_KEY) {
            // Skip new values when at limit for this key
            continue;
          }
          set.add(v);
          changed = true;
        }
      }
    }
    if (changed) this._em.emit();
  }
  onChange(fn: Listener): () => void {
    return this._em.on(fn);
  }
  getSortedKeys(): string[] {
    return Array.from(this.keys.keys()).sort((a, b) => a.localeCompare(b));
  }
  getSortedValues(key: string): string[] {
    const set = this.keys.get(canonicalDcKey(key));
    if (!set) return [] as string[];
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }
}

// Export the singleton lazily to avoid circular-init TDZ problems when modules
// import each other during startup / bundling.
export const MDCListener = lazyInstance(() => new MDCListenerImpl());
