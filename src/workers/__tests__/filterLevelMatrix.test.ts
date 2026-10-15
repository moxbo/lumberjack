import { describe, expect, it } from "vitest";
import { filterEntries as filterInUtilityProcess } from "../../main/filterProcess";
import type { ProjectionRecord } from "../../store/paged";
import {
  filterProjectionPages,
  normalizeProjection,
  type FilterOptions,
} from "../filterWorker";

const levels = [
  "TRACE",
  "debug",
  "INFO",
  "warn",
  "ERROR",
  "fatal",
  "CUSTOM",
  "ALL",
  undefined,
];
const entries = levels.map((level, index) => ({
  level,
  timestamp: new Date(1_700_000_000_000 + index).toISOString(),
  logger: "app",
  thread: "main",
  message: `entry ${index + 1}`,
  source: "matrix.log",
}));
const projections: ProjectionRecord[] = entries.map((entry, index) => ({
  ...entry,
  id: index + 1,
  level: entry.level ?? "",
  signature: `signature-${index + 1}`,
  mdc: null,
  _mark: null,
  service: null,
  traceId: null,
}));
const normalized = projections.map(normalizeProjection);
const allIds = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const matrix = [
  { level: "", ids: allIds },
  { level: "ALL", ids: allIds },
  { level: "TRACE", ids: [1, 2, 3, 4, 5, 6] },
  { level: "DEBUG", ids: [2, 3, 4, 5, 6] },
  { level: "INFO", ids: [3, 4, 5, 6] },
  { level: "WARN", ids: [4, 5, 6] },
  { level: "ERROR", ids: [5, 6] },
  { level: "FATAL", ids: [6] },
  { level: "warn", ids: [4, 5, 6] },
  { level: "custom", ids: [7] },
];

function options(level: string): FilterOptions {
  return {
    stdFiltersEnabled: true,
    filter: { level, logger: "", thread: "", message: "" },
    onlyMarked: false,
    dcFilterEnabled: false,
    dcFilterEntries: [],
    timeFilterEnabled: false,
  };
}

const engines = [
  {
    name: "utility process",
    run: (filterOptions: FilterOptions) => {
      const result = filterInUtilityProcess(entries, filterOptions);
      return {
        ...result,
        filteredIndices: result.filteredIndices.map((index) => index + 1),
      };
    },
  },
  {
    name: "paged worker",
    run: (filterOptions: FilterOptions) =>
      filterProjectionPages(
        [projections.slice(0, 4), projections.slice(4)],
        filterOptions,
      ),
  },
  {
    name: "normalized worker cache",
    run: (filterOptions: FilterOptions) =>
      filterProjectionPages(
        [normalized.slice(0, 4), normalized.slice(4)],
        filterOptions,
      ),
  },
];

describe.each(engines)("$name log-level matrix", ({ run }) => {
  it.each(matrix)("applies the '$level' threshold", ({ level, ids }) => {
    const result = run(options(level));

    expect(result.filteredIndices).toEqual(ids);
    expect(result.stats).toMatchObject({
      total: entries.length,
      passed: ids.length,
      rejectedByLevel: entries.length - ids.length,
    });
  });

  it("bypasses the matrix when standard filters are disabled", () => {
    const result = run({
      ...options("FATAL"),
      stdFiltersEnabled: false,
      filter: {
        level: "FATAL",
        logger: "not present",
        thread: "not present",
        message: "not present",
      },
    });

    expect(result.filteredIndices).toEqual(allIds);
    expect(result.stats.rejectedByLevel).toBe(0);
  });

  it("combines the threshold with the remaining standard filters", () => {
    const result = run({
      ...options("WARN"),
      filter: {
        level: "WARN",
        logger: "APP",
        thread: "MAIN",
        message: "entry&!6",
      },
    });

    expect(result.filteredIndices).toEqual([4, 5]);
    expect(result.stats).toMatchObject({
      total: entries.length,
      passed: 2,
      rejectedByLevel: 6,
      rejectedByLogger: 0,
      rejectedByThread: 0,
      rejectedByMessage: 1,
    });
  });
});
