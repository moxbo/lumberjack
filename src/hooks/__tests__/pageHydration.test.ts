import { describe, expect, it } from "vitest";
import { pruneHydratedPayloads, uniqueHydrationIds } from "../pageHydration";

describe("page hydration helpers", () => {
  it("deduplicates stable IDs while preserving virtual-item order", () => {
    expect(uniqueHydrationIds([9, 4, 9, 0, -1, 5, 4])).toEqual([9, 4, 5]);
  });

  it("keeps only requested payloads and prefers newly hydrated values", () => {
    const current = new Map([
      [1, "old-one"],
      [2, "old-two"],
      [99, "offscreen"],
    ]);
    const incoming = new Map([
      [1, "new-one"],
      [3, "new-three"],
      [100, "unrequested"],
    ]);

    expect([...pruneHydratedPayloads(current, [3, 2, 1], incoming)]).toEqual([
      [3, "new-three"],
      [2, "old-two"],
      [1, "new-one"],
    ]);
  });

  it("enforces the component cache bound", () => {
    const payloads = new Map(
      Array.from({ length: 10 }, (_, index) => [index + 1, index + 1]),
    );

    expect([
      ...pruneHydratedPayloads(payloads, [...payloads.keys()], undefined, 3),
    ]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
});
