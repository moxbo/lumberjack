import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInfo, mockWarn, mockError, mockDebug } = vi.hoisted(() => ({
  mockInfo: vi.fn(),
  mockWarn: vi.fn(),
  mockError: vi.fn(),
  mockDebug: vi.fn(),
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
    debug: mockDebug,
  },
}));

import { LoggingStrategy, LogLevel } from "../LoggingStrategy";

describe("LoggingStrategy", () => {
  let strategy: LoggingStrategy;
  beforeEach(() => {
    strategy = new LoggingStrategy();
    vi.clearAllMocks();
  });
  it("should default to INFO level", () => {
    expect(strategy.getLevel()).toBe(LogLevel.INFO);
  });
  it("should set and get global level", () => {
    strategy.setLevel(LogLevel.DEBUG);
    expect(strategy.getLevel()).toBe(LogLevel.DEBUG);
  });
  it("should log messages at or above global level", () => {
    strategy.setLevel(LogLevel.WARN);
    expect(strategy.shouldLog("test", LogLevel.WARN)).toBe(true);
    expect(strategy.shouldLog("test", LogLevel.ERROR)).toBe(true);
    expect(strategy.shouldLog("test", LogLevel.INFO)).toBe(false);
    expect(strategy.shouldLog("test", LogLevel.DEBUG)).toBe(false);
  });
  it("should set and check category-specific level", () => {
    strategy.setLevel(LogLevel.WARN);
    strategy.setCategoryLevel("parser", LogLevel.DEBUG);
    expect(strategy.shouldLog("parser", LogLevel.DEBUG)).toBe(true);
    expect(strategy.shouldLog("other", LogLevel.DEBUG)).toBe(false);
  });
  it("should getCategoryLevel fallback to global", () => {
    strategy.setLevel(LogLevel.WARN);
    expect(strategy.getCategoryLevel("unknown")).toBe(LogLevel.WARN);
    strategy.setCategoryLevel("parser", LogLevel.TRACE);
    expect(strategy.getCategoryLevel("parser")).toBe(LogLevel.TRACE);
  });
  it("should route logMessage to correct log function", () => {
    strategy.setLevel(LogLevel.TRACE);
    vi.clearAllMocks();
    strategy.logMessage("cat", LogLevel.ERROR, "error msg");
    expect(mockError).toHaveBeenCalledWith("[cat] error msg", undefined);
    strategy.logMessage("cat", LogLevel.WARN, "warn msg");
    expect(mockWarn).toHaveBeenCalledWith("[cat] warn msg", undefined);
    strategy.logMessage("cat", LogLevel.DEBUG, "debug msg");
    expect(mockDebug).toHaveBeenCalledWith("[cat] debug msg", undefined);
    // INFO (2) >= DEBUG (1) => routes to log.debug per the cascade logic
    vi.clearAllMocks();
    strategy.logMessage("cat", LogLevel.INFO, "info msg");
    expect(mockDebug).toHaveBeenCalledWith("[cat] info msg", undefined);
    // TRACE (0) < DEBUG (1) => routes to log.info (the fallback)
    vi.clearAllMocks();
    strategy.logMessage("cat", LogLevel.TRACE, "trace msg");
    expect(mockInfo).toHaveBeenCalledWith("[cat] trace msg", undefined);
  });
  it("should skip logMessage below level", () => {
    strategy.setLevel(LogLevel.ERROR);
    vi.clearAllMocks();
    strategy.logMessage("cat", LogLevel.INFO, "should not log");
    expect(mockInfo).not.toHaveBeenCalled();
    expect(mockDebug).not.toHaveBeenCalled();
  });
  it("should logMessage with data parameter", () => {
    strategy.setLevel(LogLevel.TRACE);
    vi.clearAllMocks();
    // INFO routes to log.debug per the cascade
    strategy.logMessage("cat", LogLevel.INFO, "msg", { key: "value" });
    expect(mockDebug).toHaveBeenCalledWith("[cat] msg", { key: "value" });
  });
  it("should reset categories", () => {
    strategy.setCategoryLevel("a", LogLevel.TRACE);
    strategy.setCategoryLevel("b", LogLevel.DEBUG);
    strategy.resetCategories();
    expect(strategy.getCategories().size).toBe(0);
  });
  it("should return copy of categories map", () => {
    strategy.setCategoryLevel("a", LogLevel.TRACE);
    const cats = strategy.getCategories();
    cats.set("b", LogLevel.DEBUG);
    expect(strategy.getCategories().size).toBe(1);
  });
});
