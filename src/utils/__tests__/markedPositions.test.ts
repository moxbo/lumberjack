import { describe, expect, it } from "vitest";
import {
  buildMarkedPositionIndex,
  resolveMarkedPositions,
  resolveMarkedPositionsById,
} from "../markedPositions";
import { entrySignature } from "../entryUtils";

const entry = (timestamp: string, message: string) => ({
  timestamp,
  logger: "test",
  message,
});

describe("resolveMarkedPositionsById", () => {
  it("resolves only marked signatures without scanning all entries", () => {
    const positions = new Int32Array([0, 3, 1, 2]);
    const ids = new Map<string, number | number[]>([
      ["first", 1],
      ["duplicates", [2, 3]],
    ]);

    expect(
      resolveMarkedPositionsById(
        { first: "#f00", duplicates: "#0f0" },
        (signature) => ids.get(signature),
        positions,
      ),
    ).toEqual([0, 1, 2]);
  });
});

describe("markedPositions", () => {
  it("preserves visual order independently of marks-map key order", () => {
    const entries = [entry("1", "a"), entry("2", "b"), entry("3", "c")];
    const index = buildMarkedPositionIndex(entries, [2, 0, 1]);
    const marks = {
      [entrySignature(entries[1])]: "#2",
      [entrySignature(entries[2])]: "#1",
    };

    expect(resolveMarkedPositions(index, marks)).toEqual([0, 2]);
  });

  it("returns every visual position for duplicate signatures", () => {
    const duplicate = entry("1", "same");
    const entries = [duplicate, { ...duplicate }, entry("2", "other")];
    const index = buildMarkedPositionIndex(entries, [0, 1, 2]);

    expect(
      resolveMarkedPositions(index, {
        [entrySignature(duplicate)]: "#f00",
      }),
    ).toEqual([0, 1]);
  });

  it("respects the existing visual scan limit", () => {
    const entries = [entry("1", "a"), entry("2", "b")];
    const index = buildMarkedPositionIndex(entries, [0, 1], 1);

    expect(
      resolveMarkedPositions(index, {
        [entrySignature(entries[1])]: "#f00",
      }),
    ).toEqual([]);
  });
});
