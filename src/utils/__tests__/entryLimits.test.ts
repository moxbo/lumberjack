import { describe, expect, it } from "vitest";
import { estimatePayloadBytes } from "../estimatePayloadBytes";
import {
  LogLineSplitter,
  measureEntryPayload,
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

describe("LogLineSplitter", () => {
  it("splits lines across chunk boundaries", () => {
    const splitter = new LogLineSplitter();
    const lines = [...splitter.push("one\ntw"), ...splitter.push("o\n\nthree")];
    expect(lines.map((line) => line.text)).toEqual(["one", "two"]);
    expect(splitter.flush()).toEqual({ text: "three", originalBytes: 5 });
    expect(splitter.flush()).toBeNull();
  });

  it("preserves a complete large line and the following record", () => {
    const splitter = new LogLineSplitter();
    const large = "x".repeat(4 * 1024 * 1024 + 1);
    const lines = [
      ...splitter.push(large.slice(0, 2 * 1024 * 1024)),
      ...splitter.push(large.slice(2 * 1024 * 1024)),
      ...splitter.push("\nnext\n"),
    ];
    expect(lines).toEqual([
      { text: large, originalBytes: large.length },
      { text: "next", originalBytes: 4 },
    ]);
  });

  it("flushes the entire UTF-8 tail without a newline", () => {
    const splitter = new LogLineSplitter();
    expect(splitter.push("abcdefä😀")).toEqual([]);
    expect(splitter.hasPartial).toBe(true);
    expect(splitter.flush()).toEqual({
      text: "abcdefä😀",
      originalBytes: 12,
    });
  });
});

describe("measureEntryPayload", () => {
  it("returns small entries untouched", () => {
    const entry = { message: "hi", raw: { message: "hi" } };
    const result = measureEntryPayload(entry, 1024);
    expect(result.entry).toBe(entry);
    expect(Number.isFinite(result.bytes)).toBe(true);
  });

  it("does not drop raw to make an original fit a transport budget", () => {
    const big = "x".repeat(1000);
    const entry = {
      message: "preview",
      _fullMessage: big,
      raw: { message: big, extra: big },
    };
    const limit = 4000;
    expect(() => measureEntryPayload(entry, limit)).toThrow("retain");
    expect(entry._fullMessage).toBe(big);
    expect(entry.raw.message).toBe(big);
    expect(entry.raw.extra).toBe(big);
  });

  it("never clips heavy fields or changes the original size", () => {
    const big = "y".repeat(10_000);
    const entry = {
      message: big,
      _fullMessage: big,
      stackTrace: big,
    };
    const limit = 8000;
    expect(() => measureEntryPayload(entry, limit)).toThrow("retain");
    expect(entry).toEqual({
      message: big,
      _fullMessage: big,
      stackTrace: big,
    });
    expect(Number.isFinite(estimatePayloadBytes(entry))).toBe(true);
  });
});
