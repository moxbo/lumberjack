import { describe, expect, it } from "vitest";
import { getImportProgressLabels } from "./StatusSection";

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

  it("shows x/y entries when the total is known", () => {
    expect(
      getImportProgressLabels({ processedEntries: 25, totalEntries: 100 }, t),
    ).toEqual(["toolbar.importEntryProgress:25/100"]);
  });
});
