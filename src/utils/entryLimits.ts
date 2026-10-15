import { estimatePayloadBytes } from "./estimatePayloadBytes";

export const MESSAGE_TRUNCATE_THRESHOLD = 100 * 1024;
export const MESSAGE_PREVIEW_LENGTH = 50 * 1024;

/** Transport budget, not a limit on the original payload retained on disk. */
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

export interface LogLine {
  text: string;
  originalBytes: number;
}

/** Retains complete lines so a large JSON string cannot corrupt its envelope. */
export class LogLineSplitter {
  private parts: string[] = [];
  private partialBytes = 0;

  get hasPartial(): boolean {
    return this.parts.length > 0;
  }

  push(chunk: string): LogLine[] {
    const lines: LogLine[] = [];
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
  flush(): LogLine | null {
    return this.complete();
  }

  private append(segment: string): void {
    if (!segment) return;
    this.parts.push(segment);
    this.partialBytes += Buffer.byteLength(segment, "utf8");
  }

  private complete(): LogLine | null {
    if (!this.hasPartial) return null;
    const line: LogLine = {
      text: this.parts.length === 1 ? this.parts[0]! : this.parts.join(""),
      originalBytes: this.partialBytes,
    };
    this.parts = [];
    this.partialBytes = 0;
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

/** Never sacrifice original content to make an entry fit a delivery budget. */
export function measureEntryPayload<T extends SizableEntry>(
  entry: T,
  limit = MAX_ENTRY_PAYLOAD_BYTES,
): { entry: T; bytes: number } {
  const bytes = estimatePayloadBytes(entry, limit);
  if (!Number.isFinite(bytes)) {
    throw new Error(
      "Entry exceeds the delivery budget; retain its original payload before delivery",
    );
  }
  return { entry, bytes };
}
