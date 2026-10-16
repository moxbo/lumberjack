import { describe, expect, it } from "vitest";
import { computeMdcFromRaw, LoggingStore } from "./loggingStore";

describe("computeMdcFromRaw", () => {
  it("excludes message truncation metadata from diagnostic context", () => {
    const mdc = computeMdcFromRaw({
      message: "truncated preview",
      _fullMessage: "complete large message",
      _truncated: true,
      _messageSize: 123_456,
      requestId: "request-1",
    });

    expect(mdc).toEqual({ requestId: "request-1" });
  });

  it("normalizes scalar fields and merges nested context without exposing log metadata", () => {
    expect(
      computeMdcFromRaw({
        message: "message",
        attempt: 3,
        successful: false,
        trace_id: "top-level",
        context: { tenant: "tenant-1", traceId: "nested" },
        mdc: { requestId: "request-1", attempt: 4, flags: ["a", "b"] },
      }),
    ).toEqual({
      attempt: "4",
      successful: "false",
      TraceID: "nested",
      tenant: "tenant-1",
      requestId: "request-1",
      flags: '["a","b"]',
    });
  });

  it("preserves transferred MDC when the duplicate raw payload is absent", () => {
    const entry = {
      timestamp: null,
      message: "message",
      source: "tcp:test",
      traceId: "trace-1",
      mdc: { tenant: "tenant-1", attempt: "3" },
    };
    LoggingStore.addEvents([entry]);
    expect(entry.mdc).toEqual({
      TraceID: "trace-1",
      tenant: "tenant-1",
      attempt: "3",
    });
  });

  it("keeps special JSON keys as own context properties", () => {
    const mdc = computeMdcFromRaw(JSON.parse('{"mdc":{"__proto__":"value"}}'));
    expect(Object.hasOwn(mdc, "__proto__")).toBe(true);
    expect(mdc["__proto__"]).toBe("value");
    expect(Object.getPrototypeOf(mdc)).toBe(Object.prototype);
  });
});
