import type { LogEntry } from "../types/ipc";
import { entryPayloadLoad } from "./typedApi";

const pending = new Map<string, Promise<LogEntry>>();

/** Resolve only for an explicit full view, copy, or export; never for list hydration. */
export async function loadFullEntry<T extends Record<string, unknown>>(
  entry: T,
): Promise<T> {
  if (entry._payloadRef === undefined) {
    return typeof entry._fullMessage === "string"
      ? { ...entry, message: entry._fullMessage }
      : entry;
  }
  const reference = entry._payloadRef;
  if (typeof reference !== "string")
    throw new TypeError("Invalid log payload reference");
  let request = pending.get(reference);
  if (!request) {
    request = entryPayloadLoad(reference);
    pending.set(reference, request);
    const release = () => {
      if (pending.get(reference) === request) pending.delete(reference);
    };
    void request.then(release, release);
  }
  const full = await request;
  return {
    ...entry,
    message: full.message,
    _fullMessage: full.message,
    stackTrace: full.stackTrace,
    raw: full.raw,
    mdc: full.mdc,
  };
}
