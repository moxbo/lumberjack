import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { FeatureFlags } from "../FeatureFlags";
describe("FeatureFlags", () => {
  let flags: FeatureFlags;
  beforeEach(() => {
    flags = new FeatureFlags();
  });
  it("should have all default features enabled", () => {
    expect(flags.isEnabled("TCP_SERVER")).toBe(true);
    expect(flags.isEnabled("HTTP_POLLING")).toBe(true);
    expect(flags.isEnabled("ELASTICSEARCH")).toBe(true);
    expect(flags.isEnabled("FILE_LOGGING")).toBe(true);
    expect(flags.isEnabled("HEALTH_MONITORING")).toBe(true);
    expect(flags.getStats()).toEqual({ total: 5, enabled: 5, disabled: 0 });
  });
  it("should return false for unknown features", () => {
    expect(flags.isEnabled("UNKNOWN")).toBe(false);
  });
  it("ignores retired settings and does not reintroduce them via legacy clients", () => {
    const persist = vi.fn();
    flags.setPersistCallback(persist);
    flags.loadFromSettings({
      ADAPTIVE_BATCHING: true,
      ASYNC_FILE_WRITER: true,
    });
    expect(flags.enable("ASYNC_FILE_WRITER")).toBe(false);
    expect(flags.disable("ADAPTIVE_BATCHING")).toBe(false);
    expect(flags.getStats()).toEqual({ total: 5, enabled: 5, disabled: 0 });
    expect(persist).not.toHaveBeenCalled();
    expect(flags.disable("HEALTH_MONITORING")).toBe(true);
    expect(persist).toHaveBeenLastCalledWith({ HEALTH_MONITORING: true });
    flags.resetAll();
    expect(persist).toHaveBeenLastCalledWith({});
  });
  it("should disable a feature with reason", () => {
    flags.disable("TCP_SERVER", "Port conflict");
    expect(flags.isEnabled("TCP_SERVER")).toBe(false);
    expect(flags.getDisableReason("TCP_SERVER")).toBe("Port conflict");
    expect(flags.getStats().disabled).toBe(1);
  });
  it("should re-enable a feature and clear reason", () => {
    flags.disable("TCP_SERVER", "reason");
    flags.enable("TCP_SERVER");
    expect(flags.isEnabled("TCP_SERVER")).toBe(true);
    expect(flags.getDisableReason("TCP_SERVER")).toBeUndefined();
  });
  it("should load disabled features from settings", () => {
    flags.loadFromSettings({ TCP_SERVER: "conflict", ELASTICSEARCH: true });
    expect(flags.isEnabled("TCP_SERVER")).toBe(false);
    expect(flags.isEnabled("ELASTICSEARCH")).toBe(false);
    expect(flags.isEnabled("HTTP_POLLING")).toBe(true);
  });
  it("should handle undefined settings gracefully", () => {
    flags.loadFromSettings(undefined);
    expect(flags.getStats().enabled).toBe(5);
  });
  it("should reset all features", () => {
    flags.disable("TCP_SERVER");
    flags.disable("HTTP_POLLING");
    flags.resetAll();
    expect(flags.getStats().disabled).toBe(0);
  });
  it("should getAllFeatures with status", () => {
    flags.disable("TCP_SERVER", "test");
    const all = flags.getAllFeatures();
    expect(all.get("TCP_SERVER")).toEqual({ enabled: false, reason: "test" });
    expect(all.get("HTTP_POLLING")).toEqual({
      enabled: true,
      reason: undefined,
    });
    expect(all.size).toBe(5);
  });
  it("should call persist callback on disable", () => {
    const cb = vi.fn();
    flags.setPersistCallback(cb);
    flags.disable("TCP_SERVER", "test");
    expect(cb).toHaveBeenCalledWith({ TCP_SERVER: "test" });
  });
  it("should handle persist callback errors gracefully", () => {
    flags.setPersistCallback(() => {
      throw new Error("fail");
    });
    expect(() => flags.disable("TCP_SERVER")).not.toThrow();
  });
});
