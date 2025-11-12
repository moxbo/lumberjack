/**
 * Test script for AdaptiveBatchService
 */

import { AdaptiveBatchService } from "../src/services/AdaptiveBatchService";

console.log("Running AdaptiveBatchService tests...\n");

// Test 1: Initial state
console.log("Test 1: Initial state");
const service = new AdaptiveBatchService();
const initialDelay = service.getDelay();
console.log(`✓ Initial delay: ${initialDelay}ms`);
if (initialDelay !== 8) {
  throw new Error(`Expected initial delay to be 8ms, got ${initialDelay}ms`);
}

// Test 2: Adjust for slow processing
console.log("\nTest 2: Adjust for slow processing");
service.adjustDelay(150, 5, 1000); // Slow processing time
const slowDelay = service.getDelay();
console.log(`✓ Delay after slow processing (150ms): ${slowDelay}ms`);
if (slowDelay <= initialDelay) {
  throw new Error(
    `Expected delay to increase after slow processing, got ${slowDelay}ms`,
  );
}

// Test 3: Adjust for fast processing
console.log("\nTest 3: Adjust for fast processing");
service.reset();
service.adjustDelay(10, 5, 500); // Fast processing time
const fastDelay = service.getDelay();
console.log(`✓ Delay after fast processing (10ms): ${fastDelay}ms`);
if (fastDelay >= initialDelay) {
  throw new Error(
    `Expected delay to decrease after fast processing, got ${fastDelay}ms`,
  );
}

// Test 4: Multiple adjustments
console.log("\nTest 4: Multiple slow adjustments");
service.reset();
for (let i = 0; i < 5; i++) {
  service.adjustDelay(120, 10, 2000);
}
const multiSlowDelay = service.getDelay();
console.log(`✓ Delay after multiple slow adjustments: ${multiSlowDelay}ms`);
if (multiSlowDelay <= initialDelay) {
  throw new Error(`Expected delay to increase significantly`);
}

// Test 5: Max delay limit
console.log("\nTest 5: Max delay limit");
service.reset();
for (let i = 0; i < 50; i++) {
  service.adjustDelay(200, 10, 2000);
}
const maxDelay = service.getDelay();
console.log(`✓ Delay capped at maximum: ${maxDelay}ms`);
if (maxDelay > 100) {
  throw new Error(`Expected delay to be capped at 100ms, got ${maxDelay}ms`);
}

// Test 6: Min delay limit
console.log("\nTest 6: Min delay limit");
service.reset();
for (let i = 0; i < 20; i++) {
  service.adjustDelay(5, 10, 500);
}
const minDelay = service.getDelay();
console.log(`✓ Delay floored at minimum: ${minDelay}ms`);
if (minDelay < 4) {
  throw new Error(`Expected delay to be at least 4ms, got ${minDelay}ms`);
}

// Test 7: Metrics
console.log("\nTest 7: Metrics");
service.reset();
service.adjustDelay(50, 3, 600);
service.adjustDelay(75, 5, 1000);
service.adjustDelay(60, 4, 800);
const metrics = service.getMetrics();
console.log(`✓ Metrics collected:`, metrics);
if (metrics.historySize !== 3) {
  throw new Error(`Expected 3 history entries, got ${metrics.historySize}`);
}
if (metrics.avgProcessingTime === 0) {
  throw new Error("Expected non-zero average processing time");
}

// Test 8: Reset
console.log("\nTest 8: Reset");
service.reset();
const resetDelay = service.getDelay();
const resetMetrics = service.getMetrics();
console.log(`✓ Delay after reset: ${resetDelay}ms`);
console.log(`✓ History size after reset: ${resetMetrics.historySize}`);
if (resetDelay !== 8) {
  throw new Error(`Expected reset to base delay (8ms), got ${resetDelay}ms`);
}
if (resetMetrics.historySize !== 0) {
  throw new Error(
    `Expected empty history after reset, got ${resetMetrics.historySize}`,
  );
}

console.log("\n✅ All AdaptiveBatchService tests passed!");
