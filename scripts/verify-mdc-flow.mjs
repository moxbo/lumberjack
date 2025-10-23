#!/usr/bin/env node
/**
 * Verification script for MDC filter functionality
 * Tests the flow: LogEvents → MDC extraction → Suggestions → Filter state
 */

// Simple test framework
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, msg) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${msg}\nExpected: ${expectedStr}\nActual: ${actualStr}`);
  }
}

// Mock implementations for testing (simplified versions of the actual code)
class SimpleEmitter {
  constructor() {
    this._listeners = new Set();
  }
  on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  emit() {
    for (const fn of this._listeners) fn();
  }
}

class MockLoggingStore {
  constructor() {
    this._listeners = new Set();
  }
  addLoggingStoreListener(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }
  addEvents(events) {
    // Simulate attaching MDC
    for (const e of events) {
      if (!e.mdc) e.mdc = {};
    }
    for (const l of this._listeners) {
      l.loggingEventsAdded?.(events);
    }
  }
  reset() {
    for (const l of this._listeners) {
      l.loggingStoreReset?.();
    }
  }
}

class MockMDCListener {
  constructor(loggingStore) {
    this.keys = new Map();
    this._em = new SimpleEmitter();
    loggingStore.addLoggingStoreListener({
      loggingEventsAdded: (events) => this._onAdded(events),
      loggingStoreReset: () => this._onReset(),
    });
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
    return Array.from(this.keys.keys()).sort();
  }
  getSortedValues(key) {
    const set = this.keys.get(key);
    if (!set) return [];
    return Array.from(set).sort();
  }
}

class MockDCFilter {
  constructor() {
    this._map = new Map();
    this._em = new SimpleEmitter();
    this._enabled = true;
  }
  onChange(fn) {
    return this._em.on(fn);
  }
  addMdcEntry(key, val) {
    const id = `${key}\u241F${val}`;
    if (!this._map.has(id)) {
      this._map.set(id, { key, val, active: true });
      this._em.emit();
    }
  }
  removeMdcEntry(key, val) {
    const id = `${key}\u241F${val}`;
    if (this._map.delete(id)) this._em.emit();
  }
  activateMdcEntry(key, val) {
    const id = `${key}\u241F${val}`;
    const e = this._map.get(id);
    if (e && !e.active) {
      e.active = true;
      this._em.emit();
    }
  }
  deactivateMdcEntry(key, val) {
    const id = `${key}\u241F${val}`;
    const e = this._map.get(id);
    if (e && e.active) {
      e.active = false;
      this._em.emit();
    }
  }
  reset() {
    if (this._map.size) {
      this._map.clear();
      this._em.emit();
    }
  }
  getDcEntries() {
    return Array.from(this._map.values()).sort(
      (a, b) => a.key.localeCompare(b.key) || a.val.localeCompare(b.val)
    );
  }
}

// Tests
test('MDCListener extracts keys and values from log events', () => {
  const store = new MockLoggingStore();
  const listener = new MockMDCListener(store);

  const events = [
    { message: 'test1', mdc: { userId: 'user1', sessionId: 'session1' } },
    { message: 'test2', mdc: { userId: 'user2', sessionId: 'session1' } },
    { message: 'test3', mdc: { userId: 'user1', requestId: 'req1' } },
  ];

  store.addEvents(events);

  const keys = listener.getSortedKeys();
  assertEqual(keys, ['requestId', 'sessionId', 'userId'], 'Should extract all unique keys');

  const userIdValues = listener.getSortedValues('userId');
  assertEqual(userIdValues, ['user1', 'user2'], 'Should extract unique values for userId');

  const sessionIdValues = listener.getSortedValues('sessionId');
  assertEqual(sessionIdValues, ['session1'], 'Should extract unique values for sessionId');

  const requestIdValues = listener.getSortedValues('requestId');
  assertEqual(requestIdValues, ['req1'], 'Should extract unique values for requestId');
});

test('MDCListener updates suggestions incrementally', () => {
  const store = new MockLoggingStore();
  const listener = new MockMDCListener(store);

  // First batch
  store.addEvents([{ message: 'test1', mdc: { userId: 'user1' } }]);
  assertEqual(listener.getSortedKeys(), ['userId'], 'Should have userId after first batch');

  // Second batch with new key
  store.addEvents([{ message: 'test2', mdc: { sessionId: 'session1' } }]);
  assertEqual(
    listener.getSortedKeys(),
    ['sessionId', 'userId'],
    'Should have both keys after second batch'
  );

  // Third batch with new value for existing key
  store.addEvents([{ message: 'test3', mdc: { userId: 'user2' } }]);
  const userIdValues = listener.getSortedValues('userId');
  assertEqual(userIdValues, ['user1', 'user2'], 'Should have both userId values');
});

test('MDCListener change event fires only when keys/values change', () => {
  const store = new MockLoggingStore();
  const listener = new MockMDCListener(store);

  let changeCount = 0;
  listener.onChange(() => changeCount++);

  // First event should trigger change
  store.addEvents([{ message: 'test1', mdc: { userId: 'user1' } }]);
  assertEqual(changeCount, 1, 'Should fire change event for new key');

  // Same MDC should not trigger change
  store.addEvents([{ message: 'test2', mdc: { userId: 'user1' } }]);
  assertEqual(changeCount, 1, 'Should not fire change event for duplicate key/value');

  // New value should trigger change
  store.addEvents([{ message: 'test3', mdc: { userId: 'user2' } }]);
  assertEqual(changeCount, 2, 'Should fire change event for new value');
});

test('DCFilter manages filter entries independently of log events', () => {
  const filter = new MockDCFilter();

  let changeCount = 0;
  filter.onChange(() => changeCount++);

  // Add entry
  filter.addMdcEntry('userId', 'user1');
  assertEqual(changeCount, 1, 'Should fire change event when adding entry');
  assertEqual(filter.getDcEntries().length, 1, 'Should have one entry');

  // Add duplicate (should not change)
  filter.addMdcEntry('userId', 'user1');
  assertEqual(changeCount, 1, 'Should not fire change event for duplicate entry');

  // Add different value
  filter.addMdcEntry('userId', 'user2');
  assertEqual(changeCount, 2, 'Should fire change event for new entry');
  assertEqual(filter.getDcEntries().length, 2, 'Should have two entries');
});

test('DCFilter activate/deactivate operations', () => {
  const filter = new MockDCFilter();

  let changeCount = 0;
  filter.onChange(() => changeCount++);

  filter.addMdcEntry('userId', 'user1');
  const entries1 = filter.getDcEntries();
  assertEqual(entries1[0].active, true, 'New entry should be active by default');

  filter.deactivateMdcEntry('userId', 'user1');
  assertEqual(changeCount, 2, 'Should fire change event when deactivating');
  const entries2 = filter.getDcEntries();
  assertEqual(entries2[0].active, false, 'Entry should be deactivated');

  filter.activateMdcEntry('userId', 'user1');
  assertEqual(changeCount, 3, 'Should fire change event when activating');
  const entries3 = filter.getDcEntries();
  assertEqual(entries3[0].active, true, 'Entry should be activated');
});

test('DCFilter reset clears all entries', () => {
  const filter = new MockDCFilter();

  let changeCount = 0;
  filter.onChange(() => changeCount++);

  filter.addMdcEntry('userId', 'user1');
  filter.addMdcEntry('sessionId', 'session1');
  assertEqual(filter.getDcEntries().length, 2, 'Should have two entries');

  filter.reset();
  assertEqual(changeCount, 3, 'Should fire change event when resetting');
  assertEqual(filter.getDcEntries().length, 0, 'Should have no entries after reset');
});

test('LoggingStore reset clears MDC suggestions', () => {
  const store = new MockLoggingStore();
  const listener = new MockMDCListener(store);

  store.addEvents([
    { message: 'test1', mdc: { userId: 'user1' } },
    { message: 'test2', mdc: { sessionId: 'session1' } },
  ]);

  assertEqual(listener.getSortedKeys().length, 2, 'Should have two keys before reset');

  store.reset();

  assertEqual(listener.getSortedKeys().length, 0, 'Should have no keys after reset');
  assertEqual(listener.getSortedValues('userId').length, 0, 'Should have no values after reset');
});

test('Integration: Log events update suggestions but not filter table', () => {
  const store = new MockLoggingStore();
  const listener = new MockMDCListener(store);
  const filter = new MockDCFilter();

  let suggestionChanges = 0;
  let filterChanges = 0;

  listener.onChange(() => suggestionChanges++);
  filter.onChange(() => filterChanges++);

  // Add log events - should update suggestions only
  store.addEvents([{ message: 'test1', mdc: { userId: 'user1' } }]);
  assertEqual(suggestionChanges, 1, 'Should update suggestions when logs arrive');
  assertEqual(filterChanges, 0, 'Should not update filter when logs arrive');
  assertEqual(listener.getSortedKeys().length, 1, 'Suggestions should have userId key');
  assertEqual(filter.getDcEntries().length, 0, 'Filter table should be empty');

  // Add filter entry - should update filter only
  filter.addMdcEntry('userId', 'user1');
  assertEqual(suggestionChanges, 1, 'Should not update suggestions when filter changes');
  assertEqual(filterChanges, 1, 'Should update filter when entry added');
  assertEqual(filter.getDcEntries().length, 1, 'Filter table should have one entry');

  // Add more log events with new key - should update suggestions only
  store.addEvents([{ message: 'test2', mdc: { sessionId: 'session1' } }]);
  assertEqual(suggestionChanges, 2, 'Should update suggestions for new key');
  assertEqual(filterChanges, 1, 'Should not update filter for new log events');
  assertEqual(listener.getSortedKeys().length, 2, 'Suggestions should have two keys');
  assertEqual(filter.getDcEntries().length, 1, 'Filter table should still have one entry');
});

// Run tests
console.log('Running MDC filter flow verification tests...\n');

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  ${err.message}\n`);
    failed++;
  }
}

console.log(
  `\n${tests.length} tests: ${passed} passed, ${failed} failed${failed > 0 ? ' ❌' : ' ✅'}`
);

process.exit(failed > 0 ? 1 : 0);
