#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Performance baseline / regression test
 *
 * Misst die wichtigsten Hot-Paths der Lumberjack-Datenpipeline und dient
 * als Baseline für die Quick-Wins #1–#8 sowie für die mittelfristigen
 * Refactorings (#9 inkrementelles Filtering, #10 Slim-Transferables, …).
 *
 * Sektionen:
 *   1. mergeSorted (Append-Pfad in App.tsx)
 *   2. filterEntries (volle Filter-Logik aus dem UtilityProcess)
 *   3. Slim-Projection + IPC-Payload-Größe (JSON-bytes)
 *   4. Renderer-Heap-Schätzung (process.memoryUsage RSS/heapUsed)
 *
 * Aufruf: `npm run test:smoke` (eingebettet) oder `tsx scripts/test-performance.ts`.
 */

import { compareByTimestampId } from "../src/utils/sort.js";
import {
  filterEntries as filterEntriesProc,
  type FilterOptions,
  type LogEntry,
} from "../src/main/filterProcess.js";

// ============================================================================
// Helpers
// ============================================================================

// Efficient merge function (same as in App.tsx)
function mergeSorted(prevSorted: any[], newSorted: any[]): any[] {
  if (newSorted.length === 0) return prevSorted;
  if (prevSorted.length === 0) return newSorted;

  const result: any[] = [];
  let i = 0,
    j = 0;

  while (i < prevSorted.length && j < newSorted.length) {
    if (compareByTimestampId(prevSorted[i], newSorted[j]) <= 0) {
      result.push(prevSorted[i]);
      i++;
    } else {
      result.push(newSorted[j]);
      j++;
    }
  }

  while (i < prevSorted.length) {
    result.push(prevSorted[i]);
    i++;
  }
  while (j < newSorted.length) {
    result.push(newSorted[j]);
    j++;
  }

  return result;
}

// Realistische Test-Entries (näher am echten Workload als die alten
// minimalen Stubs): variable Logger, gelegentliche StackTraces / MDC.
const LEVELS = ["INFO", "DEBUG", "WARN", "ERROR", "TRACE"] as const;
const LOGGERS = [
  "com.example.UserService",
  "com.example.OrderService",
  "com.example.PaymentService",
  "com.example.AuthService",
  "com.example.NotificationService",
  "io.acme.gateway.HttpHandler",
  "io.acme.gateway.MetricsCollector",
  "org.springframework.web.servlet.DispatcherServlet",
  "org.hibernate.SQL",
  "org.apache.kafka.clients.consumer.ConsumerCoordinator",
];

function generateEntries(count: number, startId: number): any[] {
  const entries: any[] = new Array(count);
  const startTime = Date.now() - count * 1000;

  for (let i = 0; i < count; i++) {
    const includeMdc = i % 3 === 0;
    const includeStack = i % 250 === 0;
    entries[i] = {
      _id: startId + i,
      timestamp: new Date(startTime + i * 1000).toISOString(),
      level: LEVELS[i % LEVELS.length],
      logger: LOGGERS[i % LOGGERS.length],
      thread: `pool-${(i % 8) + 1}-thread-${(i % 32) + 1}`,
      message:
        i % 7 === 0
          ? `Processing request id=${i} userId=user-${i % 1000} took ${(i % 500) + 5}ms (cache=${i % 2 ? "hit" : "miss"})`
          : `Generic log entry number ${startId + i} with payload {"k1":"v1","k2":${i % 99},"k3":"some short text"}`,
      mdc: includeMdc
        ? {
            TraceID: `trace-${(i % 100).toString(16).padStart(4, "0")}`,
            requestId: `req-${i}`,
            tenant: i % 2 ? "alpha" : "beta",
          }
        : undefined,
      stackTrace: includeStack
        ? `java.lang.RuntimeException: boom-${i}\n    at com.example.X.foo(X.java:42)\n    at com.example.X.bar(X.java:13)`
        : undefined,
      raw: { message: `raw-${i}` },
      source: "tcp://benchmark",
    };
  }

  return entries;
}

function bench<T>(
  name: string,
  fn: () => T,
  iters = 1,
): { ms: number; result: T } {
  // GC-Hint (nur wenn --expose-gc): minimiert Variabilität.
  const g = (globalThis as any).gc as undefined | (() => void);
  if (typeof g === "function") g();
  let last: T = undefined as unknown as T;
  const start = performance.now();
  for (let k = 0; k < iters; k++) last = fn();
  const ms = (performance.now() - start) / iters;
  console.log(`  ${name.padEnd(46)} ${ms.toFixed(2).padStart(9)} ms`);
  return { ms, result: last };
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function heapSnapshotMB(): { rss: number; heap: number } {
  const m = process.memoryUsage();
  return { rss: m.rss / 1024 / 1024, heap: m.heapUsed / 1024 / 1024 };
}

function logHeap(label: string): void {
  const { rss, heap } = heapSnapshotMB();
  console.log(
    `  ${label.padEnd(46)} rss=${rss.toFixed(1).padStart(7)} MB  heap=${heap.toFixed(1).padStart(7)} MB`,
  );
}

// Slim-Projektion analog zu useFilterWorker.projectToSlimEntries.
// Misst die echte IPC-Payload-Größe (JSON-bytes) für Renderer→UtilityProcess.
function projectToSlim(entries: any[]): any[] {
  const out = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) {
      out[i] = {};
      continue;
    }
    out[i] = {
      level: e.level,
      logger: e.logger,
      thread: e.thread,
      message: e.message,
      timestamp: e.timestamp,
      source: e.source,
      mdc: e.mdc,
      _mark: e._mark,
    };
  }
  return out;
}

// ============================================================================
// 1) mergeSorted (Append-Pfad)
// ============================================================================

function oldApproach(existing: any[], newEntries: any[]): any[] {
  return [...existing, ...newEntries].sort(compareByTimestampId);
}
function newApproach(existing: any[], newEntries: any[]): any[] {
  const sortedNew = newEntries.slice().sort(compareByTimestampId);
  return mergeSorted(existing, sortedNew);
}

console.log("\n══════════════════════════════════════════════════════════════");
console.log(" Section 1: mergeSorted (Append-Path)");
console.log("══════════════════════════════════════════════════════════════");

const mergeScenarios = [
  { existing: 1_000, newBatch: 100 },
  { existing: 10_000, newBatch: 1_000 },
  { existing: 50_000, newBatch: 5_000 },
  { existing: 100_000, newBatch: 10_000 },
  { existing: 300_000, newBatch: 10_000 },
];

for (const s of mergeScenarios) {
  console.log(
    `\n  Scenario: ${s.existing.toLocaleString()} existing + ${s.newBatch.toLocaleString()} new`,
  );
  const existing = generateEntries(s.existing, 0);
  existing.sort(compareByTimestampId);
  const newEntries = generateEntries(s.newBatch, s.existing);

  const oldT = bench("Old: full sort", () => oldApproach(existing, newEntries));
  const newT = bench("New: merge", () => newApproach(existing, newEntries));
  const speedup = oldT.ms / newT.ms;
  console.log(
    `  → ${(((oldT.ms - newT.ms) / oldT.ms) * 100).toFixed(1)}% faster (${speedup.toFixed(1)}x)`,
  );
}

// ============================================================================
// 2) filterEntries (UtilityProcess-Logik)
// ============================================================================

console.log("\n══════════════════════════════════════════════════════════════");
console.log(" Section 2: filterEntries (UtilityProcess)");
console.log("══════════════════════════════════════════════════════════════");

const filterSizes = [50_000, 300_000];
const filterCases: Array<{ name: string; opts: FilterOptions }> = [
  {
    name: "no filter (passes all)",
    opts: {
      stdFiltersEnabled: false,
      filter: { level: "", logger: "", thread: "", message: "" },
      onlyMarked: false,
      dcFilterEnabled: false,
      dcFilterEntries: [],
      timeFilterEnabled: false,
    },
  },
  {
    name: "level=ERROR",
    opts: {
      stdFiltersEnabled: true,
      filter: { level: "ERROR", logger: "", thread: "", message: "" },
      onlyMarked: false,
      dcFilterEnabled: false,
      dcFilterEntries: [],
      timeFilterEnabled: false,
    },
  },
  {
    name: 'message="user" & "took"',
    opts: {
      stdFiltersEnabled: true,
      filter: { level: "", logger: "", thread: "", message: "user&took" },
      onlyMarked: false,
      dcFilterEnabled: false,
      dcFilterEntries: [],
      timeFilterEnabled: false,
    },
  },
  {
    name: "DC tenant=alpha",
    opts: {
      stdFiltersEnabled: false,
      filter: { level: "", logger: "", thread: "", message: "" },
      onlyMarked: false,
      dcFilterEnabled: true,
      dcFilterEntries: [{ key: "tenant", value: "alpha", active: true }],
      timeFilterEnabled: false,
    },
  },
];

for (const n of filterSizes) {
  console.log(`\n  Dataset: ${n.toLocaleString()} entries`);
  const dataset = generateEntries(n, 0) as LogEntry[];
  for (const c of filterCases) {
    const r = bench(c.name, () => filterEntriesProc(dataset, c.opts), 1);
    console.log(
      `  ${" ".repeat(48)}passed=${r.result.filteredIndices.length.toLocaleString()}`,
    );
  }
}

// ============================================================================
// 3) Slim-Projection + IPC-Payload-Größe
// ============================================================================

console.log("\n══════════════════════════════════════════════════════════════");
console.log(" Section 3: Slim projection + IPC payload size");
console.log("══════════════════════════════════════════════════════════════");

for (const n of filterSizes) {
  console.log(`\n  Dataset: ${n.toLocaleString()} entries`);
  const full = generateEntries(n, 0);
  const projT = bench("project to slim", () => projectToSlim(full));
  const slim = projT.result as any[];

  // JSON-Bytes als Proxy für strukturiertes Klonen / IPC-Transfer-Größe.
  const sJson = bench("JSON.stringify (slim)", () => JSON.stringify(slim));
  const fJson = bench("JSON.stringify (full)", () => JSON.stringify(full));
  const slimBytes = (sJson.result as string).length;
  const fullBytes = (fJson.result as string).length;
  console.log(
    `  → IPC payload  full=${fmtBytes(fullBytes)}   slim=${fmtBytes(slimBytes)}   ratio=${((slimBytes / fullBytes) * 100).toFixed(1)}%`,
  );
}

// ============================================================================
// 4) Renderer-Heap-Schätzung (Node-Heap als Stellvertreter)
// ============================================================================

console.log("\n══════════════════════════════════════════════════════════════");
console.log(" Section 4: Heap snapshot (Node process)");
console.log("══════════════════════════════════════════════════════════════\n");

logHeap("baseline (after benchmarks above)");

for (const n of filterSizes) {
  // Erzeuge Dataset und halte Referenz, um Heap-Druck zu messen.
  const ds = generateEntries(n, 0);
  logHeap(`after generating ${n.toLocaleString()} full entries`);
  const slim = projectToSlim(ds);
  logHeap(`after projecting ${n.toLocaleString()} slim entries`);
  // halte slim am Leben bis Ende des Blocks
  void slim.length;
}

console.log("\n✅ Performance baseline test completed!");
console.log(
  "\nHinweis: Die Heap-Werte sind Node-Heap-Schätzungen, nicht der echte\n" +
    "Renderer-Heap. Sie taugen als relative Baseline für Vergleiche zwischen\n" +
    "Refactoring-Stufen, nicht als absolute Werte für Chrome.\n" +
    "Tip: mit `node --expose-gc` ausführen für stabilere Messungen.\n",
);
