import { describe, expect, it } from "vitest";
import {
  getHttpTailStatusLabels,
  getImportProgressLabels,
} from "./StatusSection";

const t = (key: string, params?: Record<string, string>): string =>
  `${key}:${params ? Object.values(params).join("/") : ""}`;

describe("getImportProgressLabels", () => {
  it("shows the current file and the processed entry count", () => {
    expect(
      getImportProgressLabels(
        {
          processedEntries: 125,
          bytesRead: 20,
          totalBytes: 100,
          fileIndex: 1,
          totalFiles: 4,
        },
        t,
      ),
    ).toEqual([
      "toolbar.importFileProgress:2/4",
      "toolbar.importEntriesRead:125",
    ]);
  });

  describe("getHttpTailStatusLabels", () => {
    it("shows a persisted-backlog pause and the interval after processing", () => {
      expect(getHttpTailStatusLabels(1, 1, null, 2, t)).toEqual({
        state: "status.httpTailPaused:1",
        next: "status.httpTailNextAfterResume:2",
      });
    });

    it("shows the countdown for a scheduled tail request", () => {
      expect(getHttpTailStatusLabels(2, 0, 4, 2, t)).toEqual({
        state: "status.httpTailingMulti:2",
        next: "status.httpTailNextIn:4",
      });
    });
  });

  it("shows x/y entries when the total is known", () => {
    expect(
      getImportProgressLabels({ processedEntries: 25, totalEntries: 100 }, t),
    ).toEqual(["toolbar.importEntryProgress:25/100"]);
  });
});
