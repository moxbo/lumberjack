import { describe, expect, it } from "vitest";
import { isFileSource, shouldDeduplicateSource } from "../entryUtils";

describe("entry source deduplication", () => {
  it("does not classify TCP streams as files or deduplicate their events", () => {
    const entry = { source: "tcp:127.0.0.1:55123" };

    expect(isFileSource(entry)).toBe(false);
    expect(shouldDeduplicateSource(entry)).toBe(false);
  });

  it("keeps deduplication for files, HTTP, and Elasticsearch", () => {
    expect(shouldDeduplicateSource({ source: "/tmp/app.log" })).toBe(true);
    expect(shouldDeduplicateSource({ source: "C:\\logs\\app.log" })).toBe(true);
    expect(
      shouldDeduplicateSource({ source: "https://logs.example/app.log" }),
    ).toBe(true);
    expect(
      shouldDeduplicateSource({ source: "elastic://logs/document-1" }),
    ).toBe(true);
  });
});
