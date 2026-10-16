import { describe, expect, it } from "vitest";
import {
  IndexedDbUnavailableError,
  PagedStorageQuotaError,
  isQuotaOrAbortError,
} from "../errors";
import {
  getStorageEstimate,
  isIndexedDbAvailable,
  openPagedDatabase,
} from "../indexedDb";

describe("paged IndexedDB errors", () => {
  it("recognizes quota and transaction abort causes", () => {
    const quota = new DOMException("full", "QuotaExceededError");
    expect(isQuotaOrAbortError(quota)).toBe(true);
    expect(
      isQuotaOrAbortError(new Error("write failed", { cause: quota })),
    ).toBe(true);
    expect(isQuotaOrAbortError(new DOMException("aborted", "AbortError"))).toBe(
      true,
    );
    expect(isQuotaOrAbortError(new Error("other"))).toBe(false);
    expect(new PagedStorageQuotaError().name).toBe("PagedStorageQuotaError");
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
