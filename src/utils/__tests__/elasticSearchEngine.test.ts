import { describe, expect, it, vi } from "vitest";
import {
  assertElasticPaginationProgress,
  ElasticPaginationStalledError,
  executeElasticSearch,
  type ExecuteElasticSearchDeps,
} from "../elasticSearchEngine";

function createDeps(
  appendCapped: ExecuteElasticSearchDeps["appendCapped"],
): ExecuteElasticSearchDeps {
  return {
    elasticUrl: "https://es.example",
    elasticSize: 100,
    search: vi.fn().mockResolvedValue({
      ok: true,
      entries: [{ source: "elastic://logs/1", message: "one" }],
      total: 1,
      hasMore: false,
    }),
    appendCapped,
    onReplaceReset: vi.fn(),
    setHasMore: vi.fn(),
    setNextSearchAfter: vi.fn(),
    setPitSessionId: vi.fn(),
    setTotal: vi.fn(),
    resetLoaded: vi.fn(),
    addLoaded: vi.fn(),
    onError: vi.fn(),
    errorUnknownText: "unknown",
  };
}

describe("executeElasticSearch", () => {
  it("does not finish or count entries before persistence completes", async () => {
    let release!: (count: number) => void;
    const persisted = new Promise<number>((resolve) => {
      release = resolve;
    });
    const deps = createDeps(() => persisted);
    let completed = false;

    const execution = executeElasticSearch(
      { index: "logs", mode: "relative", duration: "15m" },
      "append",
      deps,
    ).then(() => {
      completed = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(deps.addLoaded).not.toHaveBeenCalled();

    release(1);
    await execution;

    expect(deps.addLoaded).toHaveBeenCalledWith(1);
  });

  it("propagates persistence failures without reporting entries as loaded", async () => {
    const error = new Error("storage failed");
    const deps = createDeps(() => Promise.reject(error));

    await expect(
      executeElasticSearch(
        { index: "logs", mode: "relative", duration: "15m" },
        "append",
        deps,
      ),
    ).rejects.toBe(error);
    expect(deps.addLoaded).not.toHaveBeenCalled();
  });

  it("stops when Elasticsearch repeats a search_after cursor", async () => {
    expect(() =>
      assertElasticPaginationProgress(["cursor-1"], {
        ok: true,
        entries: [{ message: "duplicate page" }],
        hasMore: true,
        nextSearchAfter: ["cursor-1"],
      }),
    ).toThrow(ElasticPaginationStalledError);
  });

  it("stops when Elasticsearch reports more hits with an empty page", async () => {
    expect(() =>
      assertElasticPaginationProgress(["cursor-1"], {
        ok: true,
        entries: [],
        hasMore: true,
        nextSearchAfter: ["cursor-2"],
      }),
    ).toThrow(ElasticPaginationStalledError);
  });

  it("aborts auto-pagination instead of looping on a repeated cursor", async () => {
    const deps = createDeps(async (batch, available) =>
      Math.min(batch.length, available),
    );
    deps.elasticSize = 2;
    deps.search = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        entries: [{ message: "first" }],
        hasMore: true,
        nextSearchAfter: ["cursor-1"],
        pitSessionId: "pit-1",
      })
      .mockResolvedValueOnce({
        ok: true,
        entries: [{ message: "same page" }],
        hasMore: true,
        nextSearchAfter: ["cursor-1"],
        pitSessionId: "pit-1",
      });

    await expect(
      executeElasticSearch(
        { index: "logs", mode: "relative", duration: "15m" },
        "append",
        deps,
      ),
    ).rejects.toBeInstanceOf(ElasticPaginationStalledError);
    expect(deps.search).toHaveBeenCalledTimes(2);
  });
});
