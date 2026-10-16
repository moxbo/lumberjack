import { describe, expect, it } from "vitest";
import { fixedRowScroll, MAX_SCROLL_HEIGHT } from "../fixedRowScroll";

describe("fixed-row scroll coordinates", () => {
  it.each([0, 1, 100, 222_222, 222_223, 1_772_245, 5_000_000])(
    "maps the complete %i-row list to a bounded physical height",
    (count) => {
      const scroll = fixedRowScroll(count, 36, 600);
      expect(scroll.height).toBeLessThanOrEqual(MAX_SCROLL_HEIGHT);
      expect(scroll.toLogical(0)).toBe(0);
      const bottom = Math.max(0, scroll.height - 600);
      expect(scroll.toPhysical(scroll.maxOffset)).toBeCloseTo(bottom, 6);
      expect(scroll.toLogical(bottom)).toBeCloseTo(
        Math.max(0, count * 36 - 600),
        6,
      );
      for (const offset of [0, scroll.maxOffset / 2, scroll.maxOffset]) {
        expect(scroll.toLogical(scroll.toPhysical(offset))).toBeCloseTo(
          offset,
          6,
        );
        const range = scroll.range(offset, 8);
        expect(range.start).toBeGreaterThanOrEqual(0);
        expect(range.end).toBeLessThanOrEqual(count);
        expect(range.end - range.start).toBeLessThan(35);
      }
      expect(scroll.range(scroll.maxOffset, 8).end).toBe(count);
    },
  );

  it("leaves small lists unscaled and clamps empty or out-of-range targets", () => {
    const scroll = fixedRowScroll(100, 36, 600);
    expect(scroll.scale).toBe(1);
    expect(scroll.toPhysical(727)).toBe(727);
    expect(scroll.toLogical(-1)).toBe(0);
    expect(scroll.toLogical(1e9)).toBe(3000);
    expect(scroll.offsetForIndex(-1, 0, "start")).toBe(0);
    expect(scroll.offsetForIndex(101, 0, "end")).toBe(3000);
    expect(fixedRowScroll(0, 36, 600).offsetForIndex(0, 0, "end")).toBe(0);
  });

  it("aligns late rows without clamping to the browser's physical limit", () => {
    const scroll = fixedRowScroll(1_772_245, 36, 600);
    const start = 1_500_000 * 36;
    expect(scroll.offsetForIndex(1_500_000, 0, "start")).toBe(start);
    expect(scroll.offsetForIndex(1_500_000, 0, "center")).toBe(start - 282);
    expect(scroll.offsetForIndex(1_500_000, 0, "end")).toBe(start - 564);
    expect(scroll.offsetForIndex(1_500_000, start - 100, "auto")).toBe(
      start - 100,
    );
    expect(scroll.offsetForIndex(1_500_000, start + 100, "auto")).toBe(start);
    expect(scroll.offsetForIndex(1_772_244, 0, "end")).toBe(scroll.maxOffset);
  });
});
