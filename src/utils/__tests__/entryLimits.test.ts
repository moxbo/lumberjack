import { describe, expect, it } from "vitest";
import { estimatePayloadBytes } from "../estimatePayloadBytes";
import {
  BoundedLineSplitter,
  boundEntryPayload,
  truncateUtf8,
} from "../entryLimits";

describe("truncateUtf8", () => {
  it("never splits a multi-byte sequence", () => {
    const text = "aä€😀";
    for (let max = 0; max <= Buffer.byteLength(text); max++) {
      const cut = truncateUtf8(text, max);
      expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(max);
      expect(cut).not.toContain("\uFFFD");
      expect(text.startsWith(cut)).toBe(true);
    }
  });
});

describe("BoundedLineSplitter", () => {
  it("splits lines across chunk boundaries", () => {
    const splitter = new BoundedLineSplitter(64);
    const lines = [...splitter.push("one\ntw"), ...splitter.push("o\n\nthree")];
    expect(lines.map((line) => line.text)).toEqual(["one", "two"]);
    expect(splitter.flush()).toMatchObject({ text: "three", truncated: false });
    expect(splitter.flush()).toBeNull();
  });

  it("truncates an oversized line, discards its remainder and recovers", () => {
    const truncations: number[] = [];
    const splitter = new BoundedLineSplitter(8, (bytes) =>
      truncations.push(bytes),
    );
    const lines = [
      ...splitter.push("12345"),
      ...splitter.push("6789abc"),
      ...splitter.push("def\nnext\n"),
    ];
    expect(lines).toEqual([
      { text: "12345678", truncated: true, originalBytes: 15 },
      { text: "next", truncated: false, originalBytes: 4 },
    ]);
    expect(truncations).toEqual([12]);
  });

  it("flushes a truncated tail without newline", () => {
    const splitter = new BoundedLineSplitter(4);
    expect(splitter.push("abcdef")).toEqual([]);
    expect(splitter.hasPartial).toBe(true);
    expect(splitter.flush()).toEqual({
      text: "abcd",
      truncated: true,
      originalBytes: 6,
    });
  });
});

describe("boundEntryPayload", () => {
  it("returns small entries untouched", () => {
    const entry = { message: "hi", raw: { message: "hi" } };
    const result = boundEntryPayload(entry, 1024);
    expect(result.entry).toBe(entry);
    expect(Number.isFinite(result.bytes)).toBe(true);
  });

  it("drops raw first and keeps the full message when that suffices", () => {
    const big = "x".repeat(1000);
    const entry = {
      message: "preview",
      _fullMessage: big,
      raw: { message: big, extra: big },
    };
    const limit = 4000;
    const result = boundEntryPayload(entry, limit);
    expect(result.entry._fullMessage).toBe(big);
    expect(result.entry.raw).toMatchObject({ message: expect.any(String) });
    expect(result.bytes).toBeLessThanOrEqual(limit);
    expect(entry.raw.extra).toBe(big);
  });

  it("shrinks heavy fields instead of failing when even raw removal is not enough", () => {
    const big = "y".repeat(10_000);
    const entry = {
      message: big,
      _fullMessage: big,
      stackTrace: big,
    };
    const limit = 8000;
    const result = boundEntryPayload(entry, limit);
    expect(result.entry._truncated).toBe(true);
    expect(result.entry._messageSize).toBe(big.length);
    expect(result.entry._fullMessage!.length).toBeLessThanOrEqual(limit / 4);
    expect(result.entry.stackTrace!.length).toBeLessThanOrEqual(limit / 4);
    expect(result.entry.message.endsWith("… [truncated]")).toBe(true);
    expect(Number.isFinite(estimatePayloadBytes(result.entry))).toBe(true);
    expect(Number.isFinite(result.bytes)).toBe(true);
  });
});
