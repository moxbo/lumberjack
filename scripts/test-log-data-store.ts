// Test for LogDataStore functionality
import {
  createLogDataStore,
  addLogEntry,
  addLogEntries,
  filterByLevel,
  filterByLogger,
  filterByTraceId,
  filterLogEntries,
  sortLogEntries,
  getLogEntry,
  clearLogDataStore,
  type LogEntry,
} from '../src/store/logDataStore';

// Helper to create test entries
function createTestEntry(override: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2024-01-01T12:00:00.000Z',
    level: 'INFO',
    logger: 'com.example.Test',
    thread: 'main',
    message: 'Test message',
    traceId: null,
    stackTrace: null,
    raw: {},
    source: 'test',
    ...override,
  };
}

// Test suite
function runTests() {
  console.log('Running LogDataStore tests...\n');

  // Test 1: Basic add and retrieve
  {
    const store = createLogDataStore();
    const entry = createTestEntry({ message: 'Hello' });
    addLogEntry(store, entry);

    const retrieved = getLogEntry(store, 0);
    console.assert(retrieved?.message === 'Hello', 'Test 1: Basic add and retrieve');
    console.assert(store.size === 1, 'Test 1: Size should be 1');
    console.log('✓ Test 1: Basic add and retrieve');
  }

  // Test 2: Multiple entries
  {
    const store = createLogDataStore();
    const entries = [
      createTestEntry({ message: 'First', level: 'INFO' }),
      createTestEntry({ message: 'Second', level: 'ERROR' }),
      createTestEntry({ message: 'Third', level: 'WARN' }),
    ];
    addLogEntries(store, entries);

    console.assert(store.size === 3, 'Test 2: Size should be 3');
    console.assert(getLogEntry(store, 1)?.message === 'Second', 'Test 2: Get entry by index');
    console.log('✓ Test 2: Multiple entries');
  }

  // Test 3: Level index
  {
    const store = createLogDataStore();
    addLogEntries(store, [
      createTestEntry({ level: 'INFO' }),
      createTestEntry({ level: 'ERROR' }),
      createTestEntry({ level: 'INFO' }),
      createTestEntry({ level: 'WARN' }),
    ]);

    const infoIndices = filterByLevel(store, ['INFO']);
    console.assert(infoIndices.length === 2, 'Test 3: Should find 2 INFO entries');
    console.assert(infoIndices[0] === 0 && infoIndices[1] === 2, 'Test 3: Correct indices');
    console.log('✓ Test 3: Level index filtering');
  }

  // Test 4: Logger index
  {
    const store = createLogDataStore();
    addLogEntries(store, [
      createTestEntry({ logger: 'com.example.A' }),
      createTestEntry({ logger: 'com.example.B' }),
      createTestEntry({ logger: 'com.example.A' }),
    ]);

    const aIndices = filterByLogger(store, ['com.example.A']);
    console.assert(aIndices.length === 2, 'Test 4: Should find 2 logger A entries');
    console.log('✓ Test 4: Logger index filtering');
  }

  // Test 5: TraceId index
  {
    const store = createLogDataStore();
    addLogEntries(store, [
      createTestEntry({ traceId: 'trace-123' }),
      createTestEntry({ traceId: 'trace-456' }),
      createTestEntry({ traceId: 'trace-123' }),
    ]);

    const traceIndices = filterByTraceId(store, 'trace-123');
    console.assert(traceIndices.length === 2, 'Test 5: Should find 2 trace-123 entries');
    console.log('✓ Test 5: TraceId index filtering');
  }

  // Test 6: Combined filtering
  {
    const store = createLogDataStore();
    addLogEntries(store, [
      createTestEntry({ level: 'INFO', logger: 'A', message: 'Hello' }),
      createTestEntry({ level: 'ERROR', logger: 'A', message: 'World' }),
      createTestEntry({ level: 'INFO', logger: 'B', message: 'Hello' }),
      createTestEntry({ level: 'INFO', logger: 'A', message: 'Foo' }),
    ]);

    const filtered = filterLogEntries(store, {
      levels: ['INFO'],
      loggers: ['A'],
      messageContains: 'Hello',
    });

    console.assert(filtered.length === 1, 'Test 6: Combined filter should find 1 entry');
    console.assert(filtered[0] === 0, 'Test 6: Should be first entry');
    console.log('✓ Test 6: Combined filtering');
  }

  // Test 7: Timestamp sorting
  {
    const store = createLogDataStore();
    addLogEntries(store, [
      createTestEntry({ timestamp: '2024-01-03T00:00:00.000Z' }),
      createTestEntry({ timestamp: '2024-01-01T00:00:00.000Z' }),
      createTestEntry({ timestamp: '2024-01-02T00:00:00.000Z' }),
    ]);

    const sortedAsc = sortLogEntries(store, 'timestamp', 'asc');
    console.assert(sortedAsc[0] === 1, 'Test 7: First should be index 1 (asc)');
    console.assert(sortedAsc[2] === 0, 'Test 7: Last should be index 0 (asc)');

    const sortedDesc = sortLogEntries(store, 'timestamp', 'desc');
    console.assert(sortedDesc[0] === 0, 'Test 7: First should be index 0 (desc)');
    console.assert(sortedDesc[2] === 1, 'Test 7: Last should be index 1 (desc)');
    console.log('✓ Test 7: Timestamp sorting');
  }

  // Test 8: Level sorting
  {
    const store = createLogDataStore();
    addLogEntries(store, [
      createTestEntry({ level: 'INFO' }),
      createTestEntry({ level: 'FATAL' }),
      createTestEntry({ level: 'WARN' }),
      createTestEntry({ level: 'ERROR' }),
    ]);

    const sorted = sortLogEntries(store, 'level', 'asc');
    const levels = sorted.map((i) => store.levels[i]);
    console.assert(levels[0] === 'FATAL', 'Test 8: FATAL should be first');
    console.assert(levels[1] === 'ERROR', 'Test 8: ERROR should be second');
    console.log('✓ Test 8: Level sorting');
  }

  // Test 9: Sort caching
  {
    const store = createLogDataStore();
    addLogEntries(store, [
      createTestEntry({ timestamp: '2024-01-03T00:00:00.000Z' }),
      createTestEntry({ timestamp: '2024-01-01T00:00:00.000Z' }),
    ]);

    const sorted1 = sortLogEntries(store, 'timestamp', 'asc');
    const sorted2 = sortLogEntries(store, 'timestamp', 'asc');

    console.assert(sorted1 === sorted2, 'Test 9: Should return cached result');
    console.log('✓ Test 9: Sort caching');
  }

  // Test 10: Clear store
  {
    const store = createLogDataStore();
    addLogEntries(store, [createTestEntry(), createTestEntry()]);

    console.assert(store.size === 2, 'Test 10: Should have 2 entries');
    clearLogDataStore(store);
    console.assert(store.size === 0, 'Test 10: Should have 0 entries after clear');
    console.assert(store.levelIndex.size === 0, 'Test 10: Indices should be cleared');
    console.log('✓ Test 10: Clear store');
  }

  console.log('\n✅ All LogDataStore tests passed!');
}

// Run tests
runTests();
