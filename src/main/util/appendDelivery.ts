import type { LogEntry } from "../../types/ipc";

export class RendererBatchDeliveryError extends Error {
  constructor(
    message: string,
    readonly acknowledgedEntries: number,
    readonly isolatedFailureGroup?: "live",
  ) {
    super(message);
    this.name = "RendererBatchDeliveryError";
  }
}

export function getAppendFailureGroup(
  entries: readonly LogEntry[],
  failureKind?: string,
): "live" | undefined {
  return failureKind === "live-entry-limit" &&
    entries.length > 0 &&
    entries.every((entry) => entry._ingestionKind === "live")
    ? "live"
    : undefined;
}
