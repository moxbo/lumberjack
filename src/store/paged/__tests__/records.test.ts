import { describe, expect, it } from "vitest";
import {
  createEntrySignature,
  hydratePagedRecord,
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

  it("keeps projection fields out of the persisted payload", () => {
    const record = preparePagedRecord(entry, 7);

    expect(record.payload.id).toBe(7);
    expect(record.payload.entry).toMatchObject({
      _id: 7,
      stackTrace: "complete payload field",
    });
    expect("raw" in record.payload.entry).toBe(false);
    expect("id" in record.payload.entry).toBe(false);
    expect("message" in record.payload.entry).toBe(false);
    expect("mdc" in record.payload.entry).toBe(false);
    expect("source" in record.payload.entry).toBe(false);
  });

  it("creates a complete filter projection", () => {
    const record = preparePagedRecord(entry, 7);
    const signature = createEntrySignature(entry);

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
      signature,
      _mark: "#ff0",
    });
  });

  it("hydrates a complete canonical entry from payload and projection", () => {
    const record = preparePagedRecord(entry, 7);
    const signature = createEntrySignature(entry);

    expect(
      hydratePagedRecord(record.payload.entry, record.projection),
    ).toMatchObject({
      _id: 7,
      timestamp: entry.timestamp,
      level: "INFO",
      logger: "orders",
      message: "created",
      source: "file.log",
      mdc: { tenant: "acme" },
      stackTrace: "complete payload field",
      signature,
      _mark: "#ff0",
    });
  });

  it("uses full messages and elastic sources in generated signatures", () => {
    const fullSignature = createEntrySignature({
      timestamp: 1,
      logger: "logger",
      message: "short",
      _fullMessage: "full",
      source: "elastic://index/id",
    });
    const shortSignature = createEntrySignature({
      timestamp: 1,
      logger: "logger",
      message: "short",
      source: "elastic://index/id",
    });

    expect(fullSignature).toMatch(/^v2:[0-9a-f]{32}$/);
    expect(fullSignature).not.toBe(shortSignature);
  });

  it("rejects invalid stable IDs", () => {
    expect(() => preparePagedRecord(entry, 0)).toThrow(RangeError);
  });
});
