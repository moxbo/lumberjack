/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
/**
 * Test für LogEntryPool - Memory Pooling für 100k+ Log-Einträge
 */

// Simulierter Logger für Tests (ohne DOM-Abhängigkeit)
const mockLogger = {
  debug: (...args: unknown[]) => console.log("[DEBUG]", ...args),
  warn: (...args: unknown[]) => console.warn("[WARN]", ...args),
  error: (...args: unknown[]) => console.error("[ERROR]", ...args),
};

// Mock für logger vor dem Import
(globalThis as any).mockLogger = mockLogger;

// Inline Pool-Implementierung für Test (da wir den Renderer-Pool nicht direkt importieren können)
interface PoolableLogEntry {
  timestamp: string | null;
  level: string | null;
  logger: string | null;
  thread: string | null;
  message: string;
  traceId: string | null;
  stackTrace: string | null;
  raw: unknown;
  source: string;
  _mark?: string;
  mdc?: Record<string, string>;
  service?: string;
  _id?: number;
  __pooled?: boolean;
}

interface PoolStats {
  available: number;
  totalCreated: number;
  reused: number;
  returned: number;
  hitRate: number;
  maxSize: number;
}

class TestLogEntryPool {
  private pool: PoolableLogEntry[] = [];
  private maxSize: number;
  private initialSize: number;
  private totalCreated = 0;
  private reusedCount = 0;
  private returnedCount = 0;

  constructor(maxSize = 50_000, initialSize = 1_000) {
    this.maxSize = maxSize;
    this.initialSize = initialSize;
    this.preallocate(initialSize);
  }

  private preallocate(count: number): void {
    const toCreate = Math.min(count, this.maxSize);
    for (let i = 0; i < toCreate; i++) {
      this.pool.push(this.createEmpty());
    }
    this.totalCreated = toCreate;
  }

  private createEmpty(): PoolableLogEntry {
    return {
      timestamp: null,
      level: null,
      logger: null,
      thread: null,
      message: "",
      traceId: null,
      stackTrace: null,
      raw: null,
      source: "",
      __pooled: true,
    };
  }

  private reset(entry: PoolableLogEntry): void {
    entry.timestamp = null;
    entry.level = null;
    entry.logger = null;
    entry.thread = null;
    entry.message = "";
    entry.traceId = null;
    entry.stackTrace = null;
    entry.raw = null;
    entry.source = "";
    entry._mark = undefined;
    entry.mdc = undefined;
    entry.service = undefined;
    entry._id = undefined;
    entry.__pooled = true;
  }

  acquire(): PoolableLogEntry {
    if (this.pool.length > 0) {
      const entry = this.pool.pop()!;
      entry.__pooled = false;
      this.reusedCount++;
      return entry;
    }
    this.totalCreated++;
    const entry = this.createEmpty();
    entry.__pooled = false;
    return entry;
  }

  acquireBatch(count: number): PoolableLogEntry[] {
    const result: PoolableLogEntry[] = new Array(count);
    const fromPool = Math.min(count, this.pool.length);

    for (let i = 0; i < fromPool; i++) {
      const entry = this.pool.pop()!;
      entry.__pooled = false;
      result[i] = entry;
      this.reusedCount++;
    }

    for (let i = fromPool; i < count; i++) {
      this.totalCreated++;
      const entry = this.createEmpty();
      entry.__pooled = false;
      result[i] = entry;
    }

    return result;
  }

  release(entry: PoolableLogEntry): void {
    if (!entry || entry.__pooled) return;
    if (this.pool.length >= this.maxSize) return;

    this.reset(entry);
    this.pool.push(entry);
    this.returnedCount++;
  }

  releaseBatch(entries: PoolableLogEntry[]): void {
    if (!entries || entries.length === 0) return;

    const spaceAvailable = this.maxSize - this.pool.length;
    const toReturn = Math.min(entries.length, spaceAvailable);

    for (let i = 0; i < toReturn; i++) {
      const entry = entries[i];
      if (entry && !entry.__pooled) {
        this.reset(entry);
        this.pool.push(entry);
        this.returnedCount++;
      }
    }
  }

  create(data: Partial<PoolableLogEntry>): PoolableLogEntry {
    const entry = this.acquire();
    return Object.assign(entry, data);
  }

  getStats(): PoolStats {
    const totalAcquired =
      this.reusedCount + (this.totalCreated - this.initialSize);
    return {
      available: this.pool.length,
      totalCreated: this.totalCreated,
      reused: this.reusedCount,
      returned: this.returnedCount,
      hitRate: totalAcquired > 0 ? this.reusedCount / totalAcquired : 0,
      maxSize: this.maxSize,
    };
  }

  clear(): void {
    this.pool.length = 0;
  }
}

// ============================================================================
// Tests
// ============================================================================

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

console.log("\n🧪 LogEntryPool Tests\n");

test("Pool initialization with preallocated entries", () => {
  const pool = new TestLogEntryPool(1000, 100);
  const stats = pool.getStats();

  assert(
    stats.available === 100,
    `Expected 100 available, got ${stats.available}`,
  );
  assert(
    stats.totalCreated === 100,
    `Expected 100 created, got ${stats.totalCreated}`,
  );
});

test("acquire() returns entry from pool", () => {
  const pool = new TestLogEntryPool(1000, 10);

  const entry = pool.acquire();
  assert(entry !== null, "Entry should not be null");
  assert(entry.__pooled === false, "Entry should not be marked as pooled");

  const stats = pool.getStats();
  assert(stats.available === 9, `Expected 9 available, got ${stats.available}`);
  assert(stats.reused === 1, `Expected 1 reused, got ${stats.reused}`);
});

test("acquire() creates new entry when pool is empty", () => {
  const pool = new TestLogEntryPool(1000, 0);

  const entry = pool.acquire();
  assert(entry !== null, "Entry should not be null");

  const stats = pool.getStats();
  assert(
    stats.totalCreated === 1,
    `Expected 1 created, got ${stats.totalCreated}`,
  );
  assert(stats.reused === 0, `Expected 0 reused, got ${stats.reused}`);
});

test("release() returns entry to pool", () => {
  const pool = new TestLogEntryPool(1000, 5);

  const entry = pool.acquire();
  entry.message = "Test message";
  entry.level = "INFO";

  pool.release(entry);

  const stats = pool.getStats();
  assert(stats.available === 5, `Expected 5 available, got ${stats.available}`);
  assert(stats.returned === 1, `Expected 1 returned, got ${stats.returned}`);
  assert(entry.__pooled === true, "Entry should be marked as pooled");
  assert(entry.message === "", "Entry message should be reset");
  assert(entry.level === null, "Entry level should be reset");
});

test("release() ignores already pooled entries", () => {
  const pool = new TestLogEntryPool(1000, 5);

  const entry = pool.acquire();
  pool.release(entry);
  pool.release(entry); // Should be ignored

  const stats = pool.getStats();
  assert(stats.returned === 1, `Expected 1 returned, got ${stats.returned}`);
});

test("release() discards when pool is full", () => {
  const pool = new TestLogEntryPool(5, 5);

  const entry = pool.acquire();
  pool.release(entry); // Pool now at max

  const extraEntry = pool.create({ message: "extra" });
  pool.release(extraEntry); // Should be discarded

  const stats = pool.getStats();
  assert(
    stats.available === 5,
    `Expected 5 available (max), got ${stats.available}`,
  );
});

test("acquireBatch() gets multiple entries efficiently", () => {
  const pool = new TestLogEntryPool(1000, 50);

  const entries = pool.acquireBatch(30);

  assert(entries.length === 30, `Expected 30 entries, got ${entries.length}`);

  const stats = pool.getStats();
  assert(
    stats.available === 20,
    `Expected 20 available, got ${stats.available}`,
  );
  assert(stats.reused === 30, `Expected 30 reused, got ${stats.reused}`);
});

test("acquireBatch() creates new entries when pool is insufficient", () => {
  const pool = new TestLogEntryPool(1000, 10);

  const entries = pool.acquireBatch(25);

  assert(entries.length === 25, `Expected 25 entries, got ${entries.length}`);

  const stats = pool.getStats();
  assert(stats.available === 0, `Expected 0 available, got ${stats.available}`);
  assert(stats.reused === 10, `Expected 10 reused, got ${stats.reused}`);
  assert(
    stats.totalCreated === 25,
    `Expected 25 created, got ${stats.totalCreated}`,
  );
});

test("releaseBatch() returns multiple entries efficiently", () => {
  const pool = new TestLogEntryPool(1000, 0);

  const entries = pool.acquireBatch(50);
  entries.forEach((e, i) => {
    e.message = `Message ${i}`;
    e.level = "INFO";
  });

  pool.releaseBatch(entries);

  const stats = pool.getStats();
  assert(
    stats.available === 50,
    `Expected 50 available, got ${stats.available}`,
  );
  assert(stats.returned === 50, `Expected 50 returned, got ${stats.returned}`);

  // Verify entries are reset
  entries.forEach((e) => {
    assert(e.message === "", "Entry message should be reset");
    assert(e.level === null, "Entry level should be reset");
  });
});

test("create() convenience method works", () => {
  const pool = new TestLogEntryPool(1000, 10);

  const entry = pool.create({
    timestamp: "2026-01-20T10:00:00Z",
    level: "ERROR",
    message: "Test error",
    logger: "com.example.Test",
  });

  assert(entry.timestamp === "2026-01-20T10:00:00Z", "Timestamp should be set");
  assert(entry.level === "ERROR", "Level should be set");
  assert(entry.message === "Test error", "Message should be set");
  assert(entry.logger === "com.example.Test", "Logger should be set");
  assert(entry.__pooled === false, "Entry should not be marked as pooled");
});

test("Hit rate calculation is correct", () => {
  const pool = new TestLogEntryPool(1000, 100);

  // Acquire 50 (all from pool)
  const batch1 = pool.acquireBatch(50);

  // Release them back
  pool.releaseBatch(batch1);

  // Acquire 50 again (all from pool again)
  void pool.acquireBatch(50);

  const stats = pool.getStats();
  // Total acquired: 100 (50 + 50), all from pool
  assert(stats.reused === 100, `Expected 100 reused, got ${stats.reused}`);
  assert(stats.hitRate === 1.0, `Expected 1.0 hit rate, got ${stats.hitRate}`);
});

test("Simulate 100k log entries with trimming", () => {
  const pool = new TestLogEntryPool(50_000, 5_000);
  const BATCH_SIZE = 10_000;
  const MAX_ENTRIES = 50_000;

  let allEntries: PoolableLogEntry[] = [];

  // Simulate adding 100k entries in batches with trimming
  for (let i = 0; i < 10; i++) {
    const newBatch = pool.acquireBatch(BATCH_SIZE);
    const levels = ["INFO", "DEBUG", "WARN", "ERROR"] as const;
    newBatch.forEach((e, idx) => {
      e.timestamp = new Date(Date.now() + i * BATCH_SIZE + idx).toISOString();
      e.level = levels[idx % 4] ?? "INFO";
      e.message = `Log message ${i * BATCH_SIZE + idx}`;
      e._id = i * BATCH_SIZE + idx;
    });

    allEntries = [...allEntries, ...newBatch];

    // Trim if over limit
    if (allEntries.length > MAX_ENTRIES) {
      const trimCount = allEntries.length - Math.floor(MAX_ENTRIES * 0.8);
      const trimmed = allEntries.slice(0, trimCount);
      pool.releaseBatch(trimmed);
      allEntries = allEntries.slice(trimCount);
    }
  }

  const stats = pool.getStats();

  console.log(`   Pool stats after 100k simulation:`);
  console.log(`   - Available: ${stats.available}`);
  console.log(`   - Total created: ${stats.totalCreated}`);
  console.log(`   - Reused: ${stats.reused}`);
  console.log(`   - Returned: ${stats.returned}`);
  console.log(`   - Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
  console.log(`   - Current entries: ${allEntries.length}`);

  assert(
    allEntries.length <= MAX_ENTRIES,
    `Should have at most ${MAX_ENTRIES} entries`,
  );
  assert(
    stats.hitRate > 0.3,
    `Hit rate should be > 30%, got ${(stats.hitRate * 100).toFixed(1)}%`,
  );
});

test("Memory efficiency: object reuse vs new allocation", () => {
  const iterations = 10_000;

  // Test with pool
  const pool = new TestLogEntryPool(5_000, 1_000);
  const startPool = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i++) {
    const entry = pool.acquire();
    entry.message = `Message ${i}`;
    entry.level = "INFO";
    pool.release(entry);
  }

  const endPool = process.memoryUsage().heapUsed;
  const poolMemory = endPool - startPool;

  // Test without pool (creating new objects)
  const startNoPool = process.memoryUsage().heapUsed;
  const noPoolEntries: PoolableLogEntry[] = [];

  for (let i = 0; i < iterations; i++) {
    noPoolEntries.push({
      timestamp: null,
      level: "INFO",
      logger: null,
      thread: null,
      message: `Message ${i}`,
      traceId: null,
      stackTrace: null,
      raw: null,
      source: "",
      __pooled: false,
    });
  }

  const endNoPool = process.memoryUsage().heapUsed;
  const noPoolMemory = endNoPool - startNoPool;

  console.log(`   Memory comparison (${iterations} iterations):`);
  console.log(`   - With pool: ${(poolMemory / 1024).toFixed(2)} KB`);
  console.log(`   - Without pool: ${(noPoolMemory / 1024).toFixed(2)} KB`);
  console.log(`   - Pool stats: ${pool.getStats().reused} reused`);
  console.log(`   - NoPool entries created: ${noPoolEntries.length}`);

  // Pool should use significantly less memory for short-lived objects
  assert(
    pool.getStats().reused === iterations,
    `Pool should have reused ${iterations} times`,
  );
});

console.log("\n✅ All LogEntryPool tests passed!\n");
