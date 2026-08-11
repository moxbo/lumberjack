import { describe, expect, it } from "vitest";
import { compactEntrySignature, legacyEntrySignature } from "../signature";

describe("entry signatures", () => {
  const entry = {
    timestamp: "2026-01-02T03:04:05.000Z",
    logger: "orders",
    message: "created",
    source: "file.log",
  };

  it("creates deterministic compact 128-bit signatures", () => {
    const signature = compactEntrySignature(entry);
    expect(signature).toMatch(/^v2:[0-9a-f]{32}$/);
    expect(compactEntrySignature({ ...entry })).toBe(signature);
  });

  it("retains the legacy signature for mark migration", () => {
    expect(legacyEntrySignature(entry)).toBe(
      "2026-01-02T03:04:05.000Z|orders|created",
    );
  });

  it("uses full messages and distinguishes Elasticsearch documents", () => {
    const first = compactEntrySignature({
      ...entry,
      message: "short",
      _fullMessage: "full",
      source: "elastic://logs/1",
    });
    const second = compactEntrySignature({
      ...entry,
      message: "short",
      _fullMessage: "full",
      source: "elastic://logs/2",
    });
    expect(first).not.toBe(second);
  });

  it("keeps non-Elasticsearch source changes out of the mark signature", () => {
    expect(compactEntrySignature(entry)).toBe(
      compactEntrySignature({ ...entry, source: "other.log" }),
    );
  });
});
