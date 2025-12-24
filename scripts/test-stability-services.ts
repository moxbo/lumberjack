/**
 * Test script for stability services
 */

import { CircuitBreaker, CircuitState } from "../src/services/CircuitBreaker";
import { RateLimiter } from "../src/services/RateLimiter";
import { HealthMonitor } from "../src/services/HealthMonitor";

console.log("Running stability services tests...\n");

// Test 1: CircuitBreaker
console.log("Test 1: CircuitBreaker");
const breaker = new CircuitBreaker("test-service", {
  failureThreshold: 3,
  timeout: 1000,
});

let callCount = 0;
const testFunction = async () => {
  callCount++;
  if (callCount <= 3) {
    throw new Error("Service unavailable");
  }
  return "success";
};

// Test failures
for (let i = 0; i < 3; i++) {
  try {
    await breaker.execute(testFunction);
  } catch {
    // Expected to fail
  }
}

console.log(`✓ Circuit state after 3 failures: ${breaker.getState()}`);
if (breaker.getState() !== CircuitState.OPEN) {
  throw new Error("Circuit should be OPEN after threshold failures");
}

// Test circuit is open
try {
  await breaker.execute(testFunction);
  throw new Error("Should have thrown circuit open error");
} catch (e) {
  if (e instanceof Error && e.message.includes("Circuit breaker is OPEN")) {
    console.log("✓ Circuit correctly rejects calls when OPEN");
  } else {
    throw e;
  }
}

// Wait for timeout and test recovery
await new Promise((resolve) => setTimeout(resolve, 1100));

// Need multiple successes to close circuit from HALF_OPEN
const result = await breaker.execute(testFunction);
console.log(`✓ First recovery call: ${result}`);
const result2 = await breaker.execute(testFunction);
console.log(`✓ Circuit recovered and returned: ${result2}`);
if (breaker.getState() !== CircuitState.CLOSED) {
  throw new Error("Circuit should be CLOSED after successful recovery");
}

// Test 2: RateLimiter
console.log("\nTest 2: RateLimiter");
const limiter = new RateLimiter("test-limiter", {
  tokensPerInterval: 5,
  interval: 1000,
  maxTokens: 10,
});

// Consume tokens
let allowed = 0;
let throttled = 0;
for (let i = 0; i < 15; i++) {
  if (limiter.tryConsume()) {
    allowed++;
  } else {
    throttled++;
  }
}

console.log(`✓ Allowed: ${allowed}, Throttled: ${throttled}`);
if (allowed <= 0 || throttled <= 0) {
  throw new Error(`Rate limiter should allow some and throttle some requests`);
}

const stats = limiter.getStats();
console.log(`✓ Rate limiter stats:`, {
  totalRequests: stats.totalRequests,
  throttledRequests: stats.throttledRequests,
  throttleRate: stats.throttleRate,
});

// Test 3: HealthMonitor
console.log("\nTest 3: HealthMonitor");
const monitor = new HealthMonitor();

let healthyCallCount = 0;
let unhealthyCallCount = 0;

monitor.registerCheck("always-healthy", async () => {
  healthyCallCount++;
  return true;
});

monitor.registerCheck("always-unhealthy", async () => {
  unhealthyCallCount++;
  return false;
});

monitor.registerCheck("slow-check", async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return true;
});

const report = await monitor.runChecks();
console.log(`✓ Health check report:`, {
  overallStatus: report.overallStatus,
  checkCount: report.checks.length,
});

if (report.overallStatus === "healthy") {
  throw new Error("Overall status should be unhealthy with one failing check");
}

const healthyCheck = report.checks.find((c) => c.name === "always-healthy");
const unhealthyCheck = report.checks.find((c) => c.name === "always-unhealthy");

if (healthyCheck?.status !== "healthy") {
  throw new Error("always-healthy check should be healthy");
}
if (unhealthyCheck?.status !== "unhealthy") {
  throw new Error("always-unhealthy check should be unhealthy");
}

console.log("✓ Health checks executed correctly");
console.log(`  Healthy check called: ${healthyCallCount} times`);
console.log(`  Unhealthy check called: ${unhealthyCallCount} times`);

// Test monitoring
console.log("\nTest 4: Health monitoring lifecycle");
monitor.startMonitoring(500);
console.log(`✓ Monitoring started: ${monitor.isMonitoring()}`);

await new Promise((resolve) => setTimeout(resolve, 1200));
console.log(
  `✓ Health checks called after monitoring: ${healthyCallCount} times`,
);

monitor.stopMonitoring();
console.log(`✓ Monitoring stopped: ${!monitor.isMonitoring()}`);

const finalCallCount = healthyCallCount;
await new Promise((resolve) => setTimeout(resolve, 600));
if (healthyCallCount !== finalCallCount) {
  throw new Error("Monitoring should have stopped");
}
console.log("✓ Monitoring lifecycle works correctly");

console.log("\n✅ All stability services tests passed!");
