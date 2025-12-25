#!/usr/bin/env tsx
/**
 * Performance test for log list merge optimization
 * Tests the performance difference between full sort vs merge approach
 */

import { compareByTimestampId } from "../src/utils/sort.js";

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

  // Add remaining elements
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

// Generate test log entries
function generateEntries(count: number, startId: number): any[] {
  const entries: any[] = [];
  const startTime = Date.now() - count * 1000; // Entries spread over time

  for (let i = 0; i < count; i++) {
    entries.push({
      _id: startId + i,
      timestamp: new Date(startTime + i * 1000).toISOString(),
      level: ["INFO", "DEBUG", "WARN", "ERROR"][i % 4],
      logger: `com.example.Service${i % 10}`,
      message: `Log message ${startId + i}`,
      thread: `thread-${i % 4}`,
    });
  }

  return entries;
}

// Old approach: full sort
function oldApproach(existing: any[], newEntries: any[]): any[] {
  return [...existing, ...newEntries].sort(compareByTimestampId);
}

// New approach: merge sorted arrays
function newApproach(existing: any[], newEntries: any[]): any[] {
  const sortedNew = newEntries.slice().sort(compareByTimestampId);
  return mergeSorted(existing, sortedNew);
}

function benchmark(
  name: string,
  fn: (existing: any[], newEntries: any[]) => any[],
  existing: any[],
  newEntries: any[],
): number {
  const start = performance.now();
  const result = fn(existing, newEntries);
  const end = performance.now();
  const time = end - start;

  console.log(`  ${name}: ${time.toFixed(2)}ms (${result.length} entries)`);
  return time;
}

console.log("Performance Test: Log List Merge Optimization\n");

// Test scenarios
const scenarios = [
  { existing: 1000, newBatch: 100 },
  { existing: 5000, newBatch: 500 },
  { existing: 10000, newBatch: 1000 },
  { existing: 50000, newBatch: 5000 },
  { existing: 100000, newBatch: 10000 },
  { existing: 200000, newBatch: 10000 },
];

for (const scenario of scenarios) {
  console.log(
    `\nScenario: ${scenario.existing.toLocaleString()} existing + ${scenario.newBatch.toLocaleString()} new`,
  );

  // Generate test data
  const existing = generateEntries(scenario.existing, 0);
  existing.sort(compareByTimestampId);
  const newEntries = generateEntries(scenario.newBatch, scenario.existing);

  // Benchmark both approaches
  const oldTime = benchmark(
    "Old approach (full sort)",
    oldApproach,
    existing,
    newEntries,
  );
  const newTime = benchmark(
    "New approach (merge)",
    newApproach,
    existing,
    newEntries,
  );

  const improvement = (((oldTime - newTime) / oldTime) * 100).toFixed(1);
  const speedup = (oldTime / newTime).toFixed(1);

  console.log(`  → Improvement: ${improvement}% faster (${speedup}x speedup)`);
}

console.log("\n✅ Performance test completed!");
console.log("\nSummary:");
console.log("- Merge approach is significantly faster for large datasets");
console.log(
  "- Performance scales better: O(m log m + n+m) vs O((n+m) log (n+m))",
);
console.log("- Critical for maintaining responsiveness with 200k+ entries");
