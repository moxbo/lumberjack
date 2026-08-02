import { describe, expect, it } from "vitest";
import {
  createEntrySignature,
  preparePagedRecord,
  type PagedLogEntry,
} from "../types";

describe("paged record conversion", () => {
  const entry: PagedLogEntry = {
    _id: 99,
    timestamp: "2026-01-02T03:04:05.000Z",
    level: "INFO",
    logger: "orders",
    thread: "worker-1",
    message: "created",
    source: "file.log",
    mdc: { tenant: "acme" },
    service: "checkout",
    traceId: "trace-1",
    stackTrace: "complete payload field",
    raw: { large: true },
    _mark: "#ff0",
  };

  it("keeps the canonical entry complete except for raw", () => {
    const record = preparePagedRecord(entry, 7);

    expect(record.payload.id).toBe(7);
    expect(record.payload.entry).toMatchObject({
      _id: 7,
      stackTrace: "complete payload field",
      message: "created",
    });
    expect("raw" in record.payload.entry).toBe(false);
    expect("id" in record.payload.entry).toBe(false);
  });

  it("creates a complete filter projection", () => {
    const record = preparePagedRecord(entry, 7);

    expect(record.projection).toEqual({
      id: 7,
      timestamp: entry.timestamp,
      level: "INFO",
      logger: "orders",
      thread: "worker-1",
      message: "created",
      source: "file.log",
      mdc: { tenant: "acme" },
      service: "checkout",
      traceId: "trace-1",
      signature: "2026-01-02T03:04:05.000Z|orders|created",
      _mark: "#ff0",
    });
  });

  it("uses full messages and elastic sources in generated signatures", () => {
    expect(
      createEntrySignature({
        timestamp: 1,
        logger: "logger",
        message: "short",
        _fullMessage: "full",
        source: "elastic://index/id",
      }),
    ).toBe("1|logger|full|elastic://index/id");
  });

  it("rejects invalid stable IDs", () => {
    expect(() => preparePagedRecord(entry, 0)).toThrow(RangeError);
  });
});
