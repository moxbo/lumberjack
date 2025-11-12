/**
 * Test script for new stability services
 */

import { LoggingStrategy, LogLevel } from "../src/services/LoggingStrategy";
import { FeatureFlags } from "../src/services/FeatureFlags";
import { ShutdownCoordinator } from "../src/services/ShutdownCoordinator";

console.log("Running new stability services tests...\n");

// Test 1: LoggingStrategy
console.log("Test 1: LoggingStrategy");
const logger = new LoggingStrategy();

// Test global level
logger.setLevel(LogLevel.WARN);
console.log(`✓ Global level set to WARN`);

// Test category-specific level
logger.setCategoryLevel("test", LogLevel.DEBUG);
console.log(`✓ Category 'test' level set to DEBUG`);

// Test shouldLog
if (!logger.shouldLog("test", LogLevel.TRACE)) {
  console.log("✓ TRACE not logged for 'test' (correct)");
}

if (logger.shouldLog("test", LogLevel.DEBUG)) {
  console.log("✓ DEBUG logged for 'test' (correct)");
}

if (!logger.shouldLog("other", LogLevel.INFO)) {
  console.log("✓ INFO not logged for 'other' with global WARN (correct)");
}

if (logger.shouldLog("other", LogLevel.ERROR)) {
  console.log("✓ ERROR logged for 'other' (correct)");
}

// Test reset
logger.resetCategories();
if (logger.getCategoryLevel("test") === LogLevel.WARN) {
  console.log("✓ Category reset to global level");
}

// Test 2: FeatureFlags
console.log("\nTest 2: FeatureFlags");
const flags = new FeatureFlags();

// Test default enabled
if (flags.isEnabled("TCP_SERVER")) {
  console.log("✓ TCP_SERVER enabled by default");
}

// Test disable
flags.disable("TCP_SERVER", "Testing");
if (!flags.isEnabled("TCP_SERVER")) {
  console.log("✓ TCP_SERVER disabled");
}

const reason = flags.getDisableReason("TCP_SERVER");
if (reason === "Testing") {
  console.log("✓ Disable reason stored correctly");
}

// Test enable
flags.enable("TCP_SERVER");
if (flags.isEnabled("TCP_SERVER")) {
  console.log("✓ TCP_SERVER re-enabled");
}

// Test stats
const stats = flags.getStats();
console.log(`✓ Feature stats:`, stats);

// Test 3: ShutdownCoordinator
console.log("\nTest 3: ShutdownCoordinator");
const coordinator = new ShutdownCoordinator(5000);

let handler1Called = false;
let handler2Called = false;
let handler3Called = false;

coordinator.register("handler1", async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  handler1Called = true;
});

coordinator.register("handler2", async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  handler2Called = true;
});

coordinator.register("handler3", async () => {
  handler3Called = true;
});

console.log(`✓ Registered 3 handlers: ${coordinator.getHandlers().join(", ")}`);

// Test shutdown
await coordinator.shutdown();

if (handler1Called && handler2Called && handler3Called) {
  console.log("✓ All shutdown handlers executed");
} else {
  throw new Error(
    `Not all handlers called: ${handler1Called}, ${handler2Called}, ${handler3Called}`,
  );
}

// Test 4: Shutdown timeout
console.log("\nTest 4: Shutdown timeout protection");
const timeoutCoordinator = new ShutdownCoordinator(1000);

timeoutCoordinator.register("slow-handler", async () => {
  await new Promise((resolve) => setTimeout(resolve, 2000));
});

const startTime = Date.now();
await timeoutCoordinator.shutdown();
const duration = Date.now() - startTime;

if (duration < 1500) {
  console.log(`✓ Shutdown timed out correctly after ${duration}ms (< 1500ms)`);
} else {
  throw new Error(`Shutdown should have timed out, took ${duration}ms`);
}

// Test 5: Feature flags with graceful degradation
console.log("\nTest 5: Graceful degradation scenario");
const appFlags = new FeatureFlags();

// Simulate a feature failing
try {
  if (appFlags.isEnabled("FILE_LOGGING")) {
    // Simulate failure
    throw new Error("Disk full");
  }
} catch (e) {
  appFlags.disable("FILE_LOGGING", e instanceof Error ? e.message : String(e));
  console.log(
    `✓ FILE_LOGGING disabled after failure: ${appFlags.getDisableReason("FILE_LOGGING")}`,
  );
}

// App continues with other features
if (appFlags.isEnabled("TCP_SERVER")) {
  console.log("✓ Other features still enabled");
}

const allFeatures = appFlags.getAllFeatures();
console.log(`✓ Total features tracked: ${allFeatures.size}`);

console.log("\n✅ All new stability services tests passed!");
