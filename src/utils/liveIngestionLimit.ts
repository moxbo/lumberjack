export const DEFAULT_LIVE_ENTRY_LIMIT = 500_000;

export function isValidLiveEntryLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export class LiveIngestionLimitError extends Error {
  constructor(
    readonly limit: number,
    readonly storedEntries = 0,
  ) {
    super(
      `Live entry limit (${limit}) reached. Live intake is paused; existing logs are unchanged. Raise the limit or clear logs, then restart live sources. Messages arriving while paused may be lost.`,
    );
    this.name = "LiveIngestionLimitError";
  }
}
