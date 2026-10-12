import { estimatePayloadBytes } from "./estimatePayloadBytes";

/**
 * Longest single log line (UTF-8 bytes) accepted from TCP and streamed files.
 * Longer lines are truncated to this prefix; the remainder up to the next
 * newline is discarded. Sources are never terminated because of line size.
 *
 * Sized so that a worst-case entry (preview + `_fullMessage` + `raw`, counted
 * as UTF-16) stays well inside the 32 MiB window queue and the 64 MiB renderer
 * ingestion budget.
 */
export const MAX_LOG_LINE_BYTES = 4 * 1024 * 1024;

/** Largest estimated decoded payload a single entry may occupy in delivery. */
export const MAX_ENTRY_PAYLOAD_BYTES = 32 * 1024 * 1024;

/** Cuts text to at most maxBytes UTF-8 bytes without leaving a broken multi-byte sequence. */
export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // Back up over UTF-8 continuation bytes (10xxxxxx) to a character boundary.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

export interface BoundedLine {
  text: string;
  truncated: boolean;
  /** UTF-8 size of the original line including any discarded remainder. */
  originalBytes: number;
}

/**
 * Splits streamed text into newline-delimited lines while holding at most
 * `maxBytes` of any single line in memory.
 */
export class BoundedLineSplitter {
  private partial = "";
  private partialBytes = 0;
  private partialTruncated = false;
  private discardedBytes = 0;

  constructor(
    private readonly maxBytes = MAX_LOG_LINE_BYTES,
    private readonly onTruncate?: (originalBytesSoFar: number) => void,
  ) {}

  get hasPartial(): boolean {
    return this.partial.length > 0 || this.partialTruncated;
  }

  push(chunk: string): BoundedLine[] {
    const lines: BoundedLine[] = [];
    let start = 0;
    while (start < chunk.length) {
      const nl = chunk.indexOf("\n", start);
      const segment = nl < 0 ? chunk.slice(start) : chunk.slice(start, nl);
      this.append(segment);
      if (nl < 0) break;
      const line = this.complete();
      if (line) lines.push(line);
      start = nl + 1;
    }
    return lines;
  }

  /** Emits the trailing line without a newline terminator, if any. */
  flush(): BoundedLine | null {
    return this.complete();
  }

  private append(segment: string): void {
    const segmentBytes = Buffer.byteLength(segment, "utf8");
    if (this.partialTruncated) {
      this.discardedBytes += segmentBytes;
      return;
    }
    if (this.partialBytes + segmentBytes <= this.maxBytes) {
      this.partial += segment;
      this.partialBytes += segmentBytes;
      return;
    }
    const kept = truncateUtf8(this.partial + segment, this.maxBytes);
    const keptBytes = Buffer.byteLength(kept, "utf8");
    this.discardedBytes += this.partialBytes + segmentBytes - keptBytes;
    this.partial = kept;
    this.partialBytes = keptBytes;
    this.partialTruncated = true;
    this.onTruncate?.(this.partialBytes + this.discardedBytes);
  }

  private complete(): BoundedLine | null {
    if (!this.hasPartial) return null;
    const line: BoundedLine = {
      text: this.partial,
      truncated: this.partialTruncated,
      originalBytes: this.partialBytes + this.discardedBytes,
    };
    this.partial = "";
    this.partialBytes = 0;
    this.partialTruncated = false;
    this.discardedBytes = 0;
    return line;
  }
}

interface SizableEntry {
  message: string;
  raw?: unknown;
  stackTrace?: string | null;
  _fullMessage?: string;
  _truncated?: boolean;
  _messageSize?: number;
}

/**
 * Returns the entry's estimated payload size, shrinking oversized entries so
 * delivery never fails because of content size. Heavy fields are reduced in
 * order of least user-visible loss: `raw` first, then the retained full
 * message and stack trace prefixes.
 */
export function boundEntryPayload<T extends SizableEntry>(
  entry: T,
  limit = MAX_ENTRY_PAYLOAD_BYTES,
): { entry: T; bytes: number } {
  let bytes = estimatePayloadBytes(entry, limit);
  if (Number.isFinite(bytes)) return { entry, bytes };

  const bounded: T = { ...entry };
  if (bounded.raw !== undefined) {
    bounded.raw = { message: "[raw payload omitted: exceeds delivery limit]" };
    bytes = estimatePayloadBytes(bounded, limit);
    if (Number.isFinite(bytes)) return { entry: bounded, bytes };
  }

  // Keep half the budget per heavy field (estimates count UTF-16 code units).
  const maxChars = Math.floor(limit / 4);
  if (typeof bounded._fullMessage === "string") {
    bounded._messageSize ??= bounded._fullMessage.length;
    bounded._fullMessage = bounded._fullMessage.slice(0, maxChars);
    bounded._truncated = true;
  }
  if (
    typeof bounded.stackTrace === "string" &&
    bounded.stackTrace.length > maxChars
  ) {
    bounded.stackTrace = bounded.stackTrace.slice(0, maxChars);
  }
  if (bounded.message.length > maxChars) {
    bounded._messageSize ??= bounded.message.length;
    bounded.message = bounded.message.slice(0, maxChars) + "… [truncated]";
    bounded._truncated = true;
  }
  bytes = estimatePayloadBytes(bounded, limit);
  if (!Number.isFinite(bytes)) {
    // Remaining weight sits in unknown fields; estimate without the cap so
    // callers still get a usable number rather than failing the batch.
    bytes = estimatePayloadBytes(bounded);
  }
  return { entry: bounded, bytes };
}
