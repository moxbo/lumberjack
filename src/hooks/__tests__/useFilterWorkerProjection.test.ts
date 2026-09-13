import { describe, expect, it } from "vitest";
import {
  projectToSlimEntries,
  resolveFilteredEntryIds,
} from "../useFilterWorker";
import { MetadataStore } from "../../utils/metadataSnapshot";

describe("projectToSlimEntries", () => {
  const source = [
    {
      level: "INFO",
      logger: "test",
      thread: "main",
      message: "hello",
      timestamp: "2026-01-01T00:00:00Z",
      source: "file.log",
      mdc: { TraceID: "abc" },
      raw: { large: "ignored" },
    },
  ];

  it("omits MDC when diagnostic-context filtering is disabled", () => {
    const [projected] = projectToSlimEntries(source, undefined, false);

    expect(projected).not.toHaveProperty("mdc");
    expect(projected).not.toHaveProperty("raw");
  });

  it("includes MDC when diagnostic-context filtering is enabled", () => {
    const [projected] = projectToSlimEntries(source, undefined, true);

    expect(projected?.mdc).toEqual({ TraceID: "abc" });
  });

  it("maps UtilityProcess offsets back to stable entry IDs", () => {
    expect(
      resolveFilteredEntryIds(
        [{ _id: 12 }, { _id: 4 }, { message: "legacy entry" }],
        [1, 2, 0],
      ),
    ).toEqual([4, 2, 12]);
  });

  it("projects bounded metadata snapshots and resolves IDs after timestamp reordering", () => {
    const store = new MetadataStore();
    store.appendSorted([
      {
        _id: 12,
        timestamp: 1,
        source: "test.log",
        signature: "a",
        message: "first",
      },
      {
        _id: 4,
        timestamp: 3,
        source: "test.log",
        signature: "b",
        message: "last",
      },
    ]);
    const previous = store.publish();
    store.appendSorted([
      {
        _id: 7,
        timestamp: 2,
        source: "test.log",
        signature: "c",
        message: "middle",
      },
    ]);
    const current = store.publish();
    expect(projectToSlimEntries(previous).map((entry) => entry._id)).toEqual([
      12, 4,
    ]);
    expect(projectToSlimEntries(current).map((entry) => entry._id)).toEqual([
      12, 7, 4,
    ]);
    expect(resolveFilteredEntryIds(current, [1, 2])).toEqual([7, 4]);
  });
});
