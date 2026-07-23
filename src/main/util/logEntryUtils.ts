/**
 * Log Entry Utilities
 * Functions for processing and transforming log entries
 */

import type { LogEntry } from "../../types/ipc";
import { MAX_MESSAGE_LENGTH, TRUNCATION_FIELDS } from "./constants";

/**
 * Truncate large text fields in a log entry to prevent memory issues in the list view.
 * The original full message is preserved in _fullMessage for the detail panel.
 *
 * Note: If the entry was already truncated by the parser (has _truncated flag),
 * we skip re-truncation to preserve the parser's truncation with _fullMessage.
 *
 * @param entry - The log entry to truncate
 * @returns A new log entry with truncated fields (original preserved in _fullMessage)
 */
export function truncateEntryForRenderer(entry: LogEntry): LogEntry {
  try {
    if (!entry || typeof entry !== "object") return entry;

    // Drop the raw payload before it is transferred to the renderer.
    //
    // The renderer NEVER reads `raw` (verified across the detail panel, export,
    // filtering, entry signatures and DC matching). For JSON logs however `raw`
    // holds a second copy of every field, so it roughly DOUBLES the per-entry
    // memory footprint. Keeping it caused the renderer heap to explode at large
    // volumes and the app to crash/restart around ~500k entries. Removing it
    // here also shrinks the IPC structured-clone payload for every batch.
    const base = { ...(entry as Record<string, unknown>) };
    if ("raw" in base) delete base.raw;

    // If already truncated by parser, don't truncate again
    // The parser has already set _fullMessage with the original
    if (base._truncated && base._fullMessage) {
      return base as LogEntry;
    }

    const copy = base;
    let truncated = false;

    for (const field of TRUNCATION_FIELDS) {
      const value = copy[field];
      if (typeof value === "string" && value.length > MAX_MESSAGE_LENGTH) {
        // Preserve the full message for detail view (only if not already preserved)
        if (field === "message" && !copy._fullMessage) {
          copy._fullMessage = value;
          copy._messageSize = value.length;
        }
        copy[field] = value.slice(0, MAX_MESSAGE_LENGTH) + "… [truncated]";
        truncated = true;
      }
    }

    if (truncated && !copy._truncated) {
      copy._truncated = true;
    }

    return copy as LogEntry;
  } catch {
    return entry;
  }
}

/**
 * Prepare a batch of entries for rendering by truncating large fields
 * @param entries - Array of log entries
 * @returns Array of truncated log entries
 */
export function prepareRenderBatch(entries: LogEntry[]): LogEntry[] {
  try {
    if (!Array.isArray(entries) || entries.length === 0) return entries;
    return entries.map(truncateEntryForRenderer);
  } catch {
    return entries;
  }
}

/**
 * Check if entry is from TCP source
 */
export function isTcpEntry(entry: LogEntry): boolean {
  return typeof entry?.source === "string" && entry.source.startsWith("tcp:");
}

/**
 * Partition entries into TCP and non-TCP entries
 */
export function partitionBySource(entries: LogEntry[]): {
  tcpEntries: LogEntry[];
  otherEntries: LogEntry[];
} {
  const tcpEntries: LogEntry[] = [];
  const otherEntries: LogEntry[] = [];

  for (const entry of entries) {
    if (isTcpEntry(entry)) {
      tcpEntries.push(entry);
    } else {
      otherEntries.push(entry);
    }
  }

  return { tcpEntries, otherEntries };
}
