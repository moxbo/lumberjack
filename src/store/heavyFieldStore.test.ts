import { afterEach, describe, expect, it } from "vitest";
import { heavyFieldStore } from "./heavyFieldStore";

describe("heavyFieldStore", () => {
  afterEach(async () => {
    await heavyFieldStore.clear();
  });

  it("keeps offloaded fields readable when IndexedDB is unavailable", async () => {
    const record = {
      _id: 42,
      stackTrace: "Error: test\n  at example",
      _fullMessage: "full message",
    };

    await heavyFieldStore.putMany([record]);

    await expect(heavyFieldStore.get(42)).resolves.toEqual(record);
    await expect(heavyFieldStore.getMany([42])).resolves.toEqual(
      new Map([[42, record]]),
    );
  });
});
