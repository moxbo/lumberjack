import { afterEach, expect, it, vi } from "vitest";
import { FeatureFlags } from "../FeatureFlags";
import { HealthMonitor } from "../HealthMonitor";

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

afterEach(() => vi.useRealTimers());

it("runs periodic checks only while the persisted health flag is enabled", async () => {
  vi.useFakeTimers();
  const flags = new FeatureFlags();
  flags.loadFromSettings({ HEALTH_MONITORING: true });
  const monitor = new HealthMonitor();
  const check = vi.fn(async () => true);
  monitor.registerCheck("memory", check);
  const dispose = monitor.followFeatureFlag(flags);
  expect(vi.getTimerCount()).toBe(0);

  flags.enable("HEALTH_MONITORING");
  await vi.advanceTimersByTimeAsync(30_000);
  flags.disable("HTTP_POLLING");
  await vi.advanceTimersByTimeAsync(29_999);
  expect(check).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(check).toHaveBeenCalledTimes(1);

  flags.disable("HEALTH_MONITORING");
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(check).toHaveBeenCalledTimes(1);
  flags.resetAll();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(check).toHaveBeenCalledTimes(2);
  dispose();
  flags.disable("HEALTH_MONITORING");
  flags.enable("HEALTH_MONITORING");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(check).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("can cancel the first scheduled check during startup", async () => {
  vi.useFakeTimers();
  const flags = new FeatureFlags();
  const monitor = new HealthMonitor();
  const check = vi.fn(async () => true);
  monitor.registerCheck("memory", check);
  const dispose = monitor.followFeatureFlag(flags);
  expect(monitor.isMonitoring()).toBe(true);
  await vi.advanceTimersByTimeAsync(59_999);
  flags.disable("HEALTH_MONITORING");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(check).not.toHaveBeenCalled();
  dispose();
});

it("still runs an immediate check when started independently", () => {
  vi.useFakeTimers();
  const monitor = new HealthMonitor();
  const check = vi.fn(async () => true);
  monitor.registerCheck("memory", check);
  monitor.startMonitoring(500);
  expect(check).toHaveBeenCalledOnce();
  monitor.stopMonitoring();
});
