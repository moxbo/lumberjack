import { describe, expect, it } from "vitest";
import {
  IndexedDbUnavailableError,
  PagedStorageQuotaError,
  isQuotaExceededError,
  toPagedWriteError,
} from "../errors";
import {
  getStorageEstimate,
  isIndexedDbAvailable,
  openPagedDatabase,
} from "../indexedDb";

describe("paged IndexedDB errors", () => {
  it("recognizes quota errors through nested causes", () => {
    const quota = new DOMException("full", "QuotaExceededError");
    expect(isQuotaExceededError(quota)).toBe(true);
    expect(
      isQuotaExceededError(new Error("write failed", { cause: quota })),
    ).toBe(true);
    expect(isQuotaExceededError(new Error("other"))).toBe(false);
    const aborted = new Error("transaction aborted", { cause: quota });
    aborted.name = "AbortError";
    expect(isQuotaExceededError(aborted)).toBe(true);
    const wrapped = toPagedWriteError(aborted);
    expect(wrapped).toBeInstanceOf(PagedStorageQuotaError);
    expect(wrapped.cause).toBe(aborted);
  });

  it("preserves ordinary aborts without claiming the storage quota was exceeded", () => {
    const aborted = new DOMException("transaction aborted", "AbortError");
    expect(isQuotaExceededError(aborted)).toBe(false);
    expect(toPagedWriteError(aborted)).toBe(aborted);
    const wrapped = new Error("write failed", { cause: aborted });
    expect(toPagedWriteError(wrapped)).toBe(wrapped);
  });

  it("handles cyclic causes and unknown write failures", () => {
    const cyclic = new Error("write failed");
    cyclic.cause = cyclic;
    expect(isQuotaExceededError(cyclic)).toBe(false);
    expect(toPagedWriteError(cyclic)).toBe(cyclic);
    const unknown = { name: "AbortError", message: "write aborted" };
    expect(toPagedWriteError(unknown)).toMatchObject({
      message: "IndexedDB write transaction failed",
      cause: unknown,
    });
  });

  it("reports unavailable IndexedDB explicitly", async () => {
    expect(isIndexedDbAvailable()).toBe(false);
    await expect(openPagedDatabase()).rejects.toBeInstanceOf(
      IndexedDbUnavailableError,
    );
  });

  it("returns an empty estimate when the storage API is absent", async () => {
    await expect(getStorageEstimate()).resolves.toEqual({
      persisted: null,
      usage: null,
      quota: null,
    });
  });
});
