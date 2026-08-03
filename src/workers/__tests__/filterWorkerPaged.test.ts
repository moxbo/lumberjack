import { describe, expect, it } from "vitest";
import type { ProjectionRecord } from "../../store/paged";
import {
  filterProjectionPages,
  mergePassingReferences,
  type FilterOptions,
} from "../filterWorker";

function projection(
  id: number,
  overrides: Partial<ProjectionRecord> = {},
): ProjectionRecord {
  return {
    id,
    timestamp: `2026-01-01T00:00:0${id}.000Z`,
    level: "INFO",
    logger: "app",
    thread: "main",
    message: `message ${id}`,
    source: "file.log",
    mdc: null,
    service: null,
    traceId: null,
    signature: `signature-${id}`,
    _mark: null,
    ...overrides,
  };
}

function options(overrides: Partial<FilterOptions> = {}): FilterOptions {
  return {
    stdFiltersEnabled: true,
    filter: { level: "", logger: "", thread: "", message: "" },
    onlyMarked: false,
    dcFilterEnabled: false,
    dcFilterEntries: [],
    timeFilterEnabled: false,
    ...overrides,
  };
}

describe("filterProjectionPages", () => {
  it("merges appended matches without re-sorting existing matches", () => {
    const merged = mergePassingReferences(
      [
        { id: 1, _id: 1, timestamp: "2026-01-01T00:00:02Z" },
        { id: 2, _id: 2, timestamp: "2026-01-01T00:00:04Z" },
      ],
      [
        { id: 3, _id: 3, timestamp: "2026-01-01T00:00:01Z" },
        { id: 4, _id: 4, timestamp: "2026-01-01T00:00:03Z" },
      ],
    );

    expect(merged.map((entry) => entry.id)).toEqual([3, 1, 4, 2]);
  });

  it("sorts appended matches when the cached filter result is empty", () => {
    const merged = mergePassingReferences(
      [],
      [
        { id: 2, _id: 2, timestamp: "2026-01-01T00:00:02Z" },
        { id: 1, _id: 1, timestamp: "2026-01-01T00:00:01Z" },
      ],
    );

    expect(merged.map((entry) => entry.id)).toEqual([1, 2]);
  });

  it("returns stable IDs in timestamp/id order and sorted search positions", () => {
    const result = filterProjectionPages(
      [
        [
          projection(3, {
            timestamp: "2026-01-01T00:00:02Z",
            message: "needle last",
          }),
          projection(1, {
            timestamp: "2026-01-01T00:00:01Z",
            message: "needle first",
          }),
        ],
        [
          projection(2, {
            timestamp: "2026-01-01T00:00:01Z",
            message: "other",
          }),
        ],
      ],
      options({ navigationSearch: "needle" }),
    );

    expect(result.filteredIndices).toEqual([1, 2, 3]);
    expect(result.searchMatchIndices).toEqual([0, 2]);
    expect(result.stats).toMatchObject({ total: 3, passed: 3 });
  });

  it("combines current signature marks with persisted imported marks", () => {
    const result = filterProjectionPages(
      [[projection(1), projection(2, { _mark: "yellow" }), projection(3)]],
      options({ onlyMarked: true }),
      new Set(["signature-1"]),
    );

    expect(result.filteredIndices).toEqual([1, 2]);
    expect(result.stats.rejectedByOnlyMarked).toBe(1);
  });

  it("preserves filter rejection order, Elastic time, and DC semantics", () => {
    const result = filterProjectionPages(
      [
        [
          projection(1, { level: "DEBUG", logger: "wrong" }),
          projection(2, {
            source: "elastic://logs",
            timestamp: "2025-12-31T23:00:00Z",
          }),
          projection(3, { mdc: { tenant: "other" } }),
          projection(4, { mdc: { tenant: "acme" } }),
        ],
      ],
      options({
        filter: {
          level: "INFO",
          logger: "app",
          thread: "main",
          message: "message",
        },
        timeFilterEnabled: true,
        timeFilterFrom: "2026-01-01T00:00:00Z",
        dcFilterEnabled: true,
        dcFilterEntries: [{ key: "tenant", value: "acme", active: true }],
      }),
    );

    expect(result.filteredIndices).toEqual([4]);
    expect(result.stats).toMatchObject({
      total: 4,
      passed: 1,
      rejectedByLevel: 1,
      rejectedByTime: 1,
      rejectedByDC: 1,
      rejectedByLogger: 0,
    });
  });

  it("does not evaluate search positions beyond 50 000 sorted results", () => {
    const pages: ProjectionRecord[][] = [];
    const PAGE = 1000;
    for (let base = 0; base < 51; base++) {
      const page: ProjectionRecord[] = [];
      for (let i = 0; i < (base < 50 ? PAGE : 1); i++) {
        const globalId = base * PAGE + i + 1;
        page.push(
          projection(globalId, {
            timestamp: `2026-01-01T00:00:00.${String(globalId).padStart(6, "0")}Z`,
            message: base * PAGE + i < 50_000 ? "not-needle" : "needle extra",
          }),
        );
      }
      pages.push(page);
    }

    const result = filterProjectionPages(
      pages,
      options({ navigationSearch: "needle extra" }),
    );

    expect(result.filteredIndices.length).toBe(50_001);
    expect(result.searchMatchIndices).toEqual([]);
    const ids = result.filteredIndices;
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]!).toBeGreaterThan(ids[i - 1]!);
    }
  });

  it("evaluates search for entries within first 50 000 sorted results", () => {
    const result = filterProjectionPages(
      [
        [
          projection(1, {
            message: "needle at start",
            timestamp: "2026-01-01T00:00:01Z",
          }),
          projection(2, {
            message: "no match",
            timestamp: "2026-01-01T00:00:02Z",
          }),
        ],
      ],
      options({ navigationSearch: "needle at start" }),
    );

    expect(result.filteredIndices).toEqual([1, 2]);
    expect(result.searchMatchIndices).toEqual([0]);
  });
});
