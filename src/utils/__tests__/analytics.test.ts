import { describe, expect, it } from "vitest";
import {
  KNOWN_LEVELS,
  levelHistogram,
  summarise,
  timeBuckets,
  topLoggers,
} from "../analytics";

const MIXED = [
  { level: "ERROR", logger: "a", timestamp: 1_700_000_000_000 },
  { level: "error", logger: "a", timestamp: 1_700_000_001_000 },
  { level: "INFO", logger: "b", timestamp: 1_700_000_002_000 },
  { level: "WARN", logger: "b", timestamp: 1_700_000_010_000 },
  { level: "WARN", logger: "c", timestamp: 1_700_000_020_000 },
  { level: "FATAL", logger: "a", timestamp: 1_700_000_030_000 },
  { level: "CUSTOM", logger: "", timestamp: null },
];

describe("levelHistogram", () => {
  it("counts case-insensitively and orders by KNOWN_LEVELS first", () => {
    const h = levelHistogram(MIXED);
    const lvls = h.map((b) => b.level);
    // Known levels appear in their canonical order.
    const knownInOrder = lvls.filter((l) => KNOWN_LEVELS.includes(l));
    const expected = KNOWN_LEVELS.filter((l) => lvls.includes(l));
    expect(knownInOrder).toEqual(expected);
    // CUSTOM is at the end.
    expect(lvls[lvls.length - 1]).toBe("CUSTOM");
  });
  it("share sums to 1 (within rounding)", () => {
    const h = levelHistogram(MIXED);
    const sum = h.reduce((s, b) => s + b.share, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
  it("ERROR count is 2 (case-insensitive)", () => {
    const h = levelHistogram(MIXED);
    expect(h.find((b) => b.level === "ERROR")?.count).toBe(2);
  });
});

describe("topLoggers", () => {
  it("returns descending counts and respects limit", () => {
    const t = topLoggers(MIXED, 2);
    expect(t).toHaveLength(2);
    expect(t[0]?.count).toBeGreaterThanOrEqual(t[1]?.count ?? 0);
  });
  it("ignores empty logger names", () => {
    const t = topLoggers(MIXED, 10);
    expect(t.find((x) => x.logger === "")).toBeUndefined();
  });
});

describe("timeBuckets", () => {
  it("returns sorted buckets", () => {
    const buckets = timeBuckets(MIXED, 5);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]!.startMs).toBeGreaterThan(buckets[i - 1]!.startMs);
    }
  });
  it("returns empty array when no parseable timestamps", () => {
    expect(
      timeBuckets([{ level: "INFO", logger: "x", timestamp: null }]),
    ).toEqual([]);
  });
});

describe("summarise", () => {
  it("counts errors (incl. FATAL) and warnings (incl. WARNING)", () => {
    const s = summarise([
      { level: "ERROR" },
      { level: "FATAL" },
      { level: "WARN" },
      { level: "WARNING" },
      { level: "INFO" },
    ]);
    expect(s.total).toBe(5);
    expect(s.errorCount).toBe(2);
    expect(s.warnCount).toBe(2);
  });
  it("computes start/end timestamps from valid entries", () => {
    const s = summarise(MIXED);
    expect(s.startMs).toBe(1_700_000_000_000);
    expect(s.endMs).toBe(1_700_000_030_000);
  });
});
