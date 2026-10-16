export class IndexedDbUnavailableError extends Error {
  constructor(message = "IndexedDB is unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "IndexedDbUnavailableError";
  }
}

export class PagedStorageQuotaError extends Error {
  constructor(
    message = "IndexedDB storage quota was exceeded",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PagedStorageQuotaError";
  }
}

function errorName(error: unknown): string | undefined {
  if (error && typeof error === "object" && "name" in error) {
    return String(error.name);
  }
  return undefined;
}

export function isQuotaOrAbortError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const name = errorName(current);
    if (name === "QuotaExceededError" || name === "AbortError") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

export function toPagedWriteError(error: unknown): Error {
  if (isQuotaOrAbortError(error)) {
    return new PagedStorageQuotaError(undefined, { cause: error });
  }
  return error instanceof Error
    ? error
    : new Error("IndexedDB write transaction failed", { cause: error });
}
