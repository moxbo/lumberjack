import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { PerformanceService } from "../PerformanceService";
describe("PerformanceService", () => {
  let service: PerformanceService;
  beforeEach(() => {
    service = new PerformanceService();
  });
  it("should create with app-start mark", () => {
    const metrics = service.getMetrics();
    expect(metrics.marks.length).toBeGreaterThanOrEqual(1);
    expect(metrics.marks[0]?.name).toBe("app-start");
  });
  it("should add marks with duration from start", () => {
    service.mark("test-mark");
    const metrics = service.getMetrics();
    const testMark = metrics.marks.find((m) => m.name === "test-mark");
    expect(testMark).toBeDefined();
    expect(testMark!.duration).toBeGreaterThanOrEqual(0);
  });
  it("should measure between two marks", () => {
    service.mark("start");
    service.mark("end");
    const duration = service.measure("test", "start", "end");
    expect(duration).not.toBeNull();
    expect(duration).toBeGreaterThanOrEqual(0);
  });
  it("should measure from mark to now", () => {
    service.mark("start");
    const duration = service.measure("test", "start");
    expect(duration).not.toBeNull();
    expect(duration).toBeGreaterThanOrEqual(0);
  });
  it("should return null for missing marks", () => {
    expect(service.measure("test", "nonexistent", "also-missing")).toBeNull();
  });
  it("should return elapsed time since start", () => {
    const elapsed = service.getElapsedTime();
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });
  it("should include platform info in metrics", () => {
    const metrics = service.getMetrics();
    expect(metrics.platform).toBe(process.platform);
    expect(metrics.nodeVersion).toBe(process.versions.node);
  });
  it("should not throw on logSummary", () => {
    service.mark("a");
    service.mark("b");
    expect(() => service.logSummary()).not.toThrow();
  });
  it("should not throw on checkStartupPerformance", () => {
    expect(() => service.checkStartupPerformance()).not.toThrow();
    expect(() => service.checkStartupPerformance(1)).not.toThrow();
  });
  it("should not throw on logDetailedBreakdown", () => {
    service.mark("a");
    service.mark("b");
    expect(() => service.logDetailedBreakdown()).not.toThrow();
  });
});
