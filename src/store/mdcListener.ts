// MDCListener: sammelt bekannte MDC-Schlüssel und Werte aus dem LoggingStore
// keys: Map<string, Set<string>>; hält interne Sortierung nicht, liefert aber sortierte Arrays per Getter

import { lazyInstance } from './_lazy.js';

class SimpleEmitter {
  constructor() {
    this._ls = new Set();
  }
  on(fn) {
    if (typeof fn === 'function') {
      this._ls.add(fn);
      return () => this._ls.delete(fn);
    }
    return () => {};
  }
  emit() {
    for (const fn of this._ls) {
      try {
        fn();
      } catch {}
    }
  }
}

class MDCListenerImpl {
  constructor() {
    this.keys = new Map(); // key -> Set(values)
    this._em = new SimpleEmitter();
    // No automatic subscription here. Call startListening() from app startup
    // (e.g. in App.jsx) to wire this listener after modules are initialized.
  }

  startListening() {
    try {
      // guard: multiple calls should not add duplicate listeners
      if (this._started) return;
      this._started = true;
      // Load LoggingStore dynamically to avoid a static circular import
      import('./loggingStore.js')
        .then((mod) => {
          const LS = mod?.LoggingStore || mod?.default;
          try {
            LS?.addLoggingStoreListener({
              loggingEventsAdded: (events) => this._onAdded(events),
              loggingStoreReset: () => this._onReset(),
            });
          } catch (e) {}
        })
        .catch(() => {});
    } catch (e) {
      // ignore failures (defensive)
    }
  }

  _onReset() {
    this.keys.clear();
    this._em.emit();
  }
  _onAdded(events) {
    let changed = false;
    for (const e of events || []) {
      const mdc = (e && e.mdc) || {};
      for (const [k, v] of Object.entries(mdc)) {
        if (!k || typeof v !== 'string') continue;
        if (!this.keys.has(k)) {
          this.keys.set(k, new Set());
          changed = true;
        }
        const set = this.keys.get(k);
        if (!set.has(v)) {
          set.add(v);
          changed = true;
        }
      }
    }
    if (changed) this._em.emit();
  }
  onChange(fn) {
    return this._em.on(fn);
  }
  getSortedKeys() {
    return Array.from(this.keys.keys()).sort((a, b) => a.localeCompare(b));
  }
  getSortedValues(key) {
    const set = this.keys.get(key);
    if (!set) return [];
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }
}

// Export the singleton lazily to avoid circular-init TDZ problems when modules
// import each other during startup / bundling.
export const MDCListener = lazyInstance(() => new MDCListenerImpl());
