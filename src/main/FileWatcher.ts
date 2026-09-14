/**
 * FileWatcher – tail-style log watching.
 *
 * Watches a file with `fs.watchFile` (poll-based, robust across editors and
 * filesystems) and reads only newly-appended bytes since the last read. When
 * truncation is detected (size shrinks) the watcher resets to offset 0 so it
 * can re-tail rotated logs.
 *
 * Each watcher is independent; the WatchManager keeps a registry per id and
 * delivers new bytes line-by-line to a sink callback.
 */

import * as fs from "fs";
import { StringDecoder } from "string_decoder";

export interface WatcherCallbacks {
  /** Called with newly-arrived raw text lines (without trailing \n). */
  onLines: (lines: string[]) => unknown;
  /** Optional error sink. */
  onError?: (err: Error) => void;
  /** Optional truncation/rotation notification. */
  onRotated?: () => void;
}

export interface WatcherOptions {
  /** Polling interval in ms. Default 500. */
  pollIntervalMs?: number;
  /**
   * If true, the watcher reads the entire current file on start (good for
   * "open file with tail"). If false (default), only new bytes after start
   * will be delivered.
   */
  emitInitial?: boolean;
  /** Hard cap for a single read chunk (bytes). Default 4 MiB. */
  maxReadBytes?: number;
}

export interface ActiveWatcher {
  id: number;
  filePath: string;
  /** Bytes already delivered (next read starts here). */
  offset: number;
  /** Last seen file size – used for truncation detection. */
  lastSize: number;
  /** Buffer for an incomplete trailing line across reads. */
  carry: string;
  /** Decoder that preserves multi-byte UTF-8 chars split across read chunks. */
  decoder: StringDecoder;
  stop: () => void;
}

let _idCounter = 1;

const DEFAULT_POLL_MS = 500;
const DEFAULT_MAX_READ = 4 * 1024 * 1024;

export class WatchManager {
  private watchers = new Map<number, ActiveWatcher>();

  /**
   * Start watching `filePath`. Returns the new watcher id.
   * Throws if the path does not exist or is not a regular file.
   */
  start(
    filePath: string,
    cbs: WatcherCallbacks,
    opts: WatcherOptions = {},
  ): ActiveWatcher {
    if (this.watchers.size >= 16)
      throw new Error("File watcher capacity exceeded");
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      throw new Error("Not a regular file: " + filePath);
    }

    const id = _idCounter++;
    const initialOffset = opts.emitInitial ? 0 : stat.size;
    const watcher: ActiveWatcher = {
      id,
      filePath,
      offset: initialOffset,
      lastSize: stat.size,
      carry: "",
      decoder: new StringDecoder("utf8"),
      stop: () => {
        /* will be replaced below */
      },
    };

    const interval = Math.max(50, opts.pollIntervalMs ?? DEFAULT_POLL_MS);
    const maxRead = Math.min(
      DEFAULT_MAX_READ,
      Math.max(64 * 1024, opts.maxReadBytes ?? DEFAULT_MAX_READ),
    );

    let busy = false;
    let stopped = false;
    let latest: fs.Stats | null = null;
    const onChange: fs.StatsListener = (curr) => {
      latest = curr;
      if (busy || stopped) return;
      busy = true;
      void (async () => {
        while (latest && !stopped) {
          const next = latest;
          latest = null;
          await this.process(watcher, cbs, maxRead, next);
        }
      })()
        .catch((err: unknown) => {
          watcher.stop();
          cbs.onError?.(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          busy = false;
        });
    };

    fs.watchFile(filePath, { interval, persistent: true }, onChange);

    watcher.stop = (): void => {
      stopped = true;
      latest = null;
      watcher.carry = "";
      fs.unwatchFile(filePath, onChange);
      this.watchers.delete(id);
    };

    this.watchers.set(id, watcher);

    // If emitInitial is set, kick off a first read immediately so callers see
    // the existing content without waiting for the next poll tick.
    if (opts.emitInitial && stat.size > 0) {
      onChange(stat, stat);
    }

    return watcher;
  }

  stop(id: number): boolean {
    const w = this.watchers.get(id);
    if (!w) return false;
    w.stop();
    return true;
  }

  stopAll(): void {
    for (const w of Array.from(this.watchers.values())) w.stop();
  }

  list(): Array<{ id: number; filePath: string }> {
    return Array.from(this.watchers.values()).map((w) => ({
      id: w.id,
      filePath: w.filePath,
    }));
  }

  /**
   * Read newly-appended bytes (or recover from truncation).
   * Splits the buffered text into complete lines and forwards them.
   */
  private async process(
    w: ActiveWatcher,
    cbs: WatcherCallbacks,
    maxRead: number,
    curr: fs.Stats,
  ): Promise<void> {
    // Truncation / rotation: file shrank → restart from 0
    if (curr.size < w.lastSize) {
      w.offset = 0;
      w.carry = "";
      w.decoder = new StringDecoder("utf8");
      cbs.onRotated?.();
    }
    w.lastSize = curr.size;

    if (curr.size <= w.offset) return;

    const fd = await fs.promises.open(w.filePath, "r");
    try {
      // Drain ALL currently-available bytes in maxRead-sized chunks. A single
      // change event (or the initial emit) must fully catch up to curr.size –
      // otherwise large existing files or big appends would only be partially
      // read, because fs.watchFile does not fire again while the size is stable.
      while (this.watchers.has(w.id) && w.offset < curr.size) {
        const start = w.offset;
        const end = Math.min(curr.size, start + maxRead);
        const length = end - start;
        const buf = Buffer.alloc(length);
        const { bytesRead } = await fd.read(buf, 0, length, start);
        if (bytesRead <= 0) break;
        if (!this.watchers.has(w.id)) return;
        // Decoder keeps any incomplete multi-byte sequence at the chunk boundary.
        const text = w.carry + w.decoder.write(buf.subarray(0, bytesRead));
        const newlineIdx = text.lastIndexOf("\n");
        if (newlineIdx === -1) {
          // No newline yet → keep buffering. Cap the carry size to avoid OOM
          // for pathological inputs without line breaks.
          const MAX_CARRY = 1024 * 1024;
          if (Buffer.byteLength(text, "utf8") > MAX_CARRY) {
            throw new Error("File watcher line exceeds 1 MiB; watcher stopped");
          }
          w.carry = text;
          w.offset = start + bytesRead;
          continue;
        }
        const completePart = text.slice(0, newlineIdx);
        w.carry = text.slice(newlineIdx + 1);
        const lines = completePart
          .split("\n")
          .map((s) => (s.endsWith("\r") ? s.slice(0, -1) : s));
        // Drop empty last item from a trailing newline
        if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        if (
          lines.some((line) => Buffer.byteLength(line, "utf8") > 1024 * 1024) ||
          Buffer.byteLength(w.carry, "utf8") > 1024 * 1024
        ) {
          throw new Error("File watcher line exceeds 1 MiB; watcher stopped");
        }
        if (lines.length > 0) await cbs.onLines(lines);
        w.offset = start + bytesRead;
      }
    } finally {
      await fd.close().catch(() => undefined);
    }
  }
}

/** Convenience: split a raw buffer into lines (used by tests). */
export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l))
    .filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
}
