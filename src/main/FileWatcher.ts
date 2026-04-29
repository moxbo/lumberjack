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

export interface WatcherCallbacks {
  /** Called with newly-arrived raw text lines (without trailing \n). */
  onLines: (lines: string[]) => void;
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
      stop: () => {
        /* will be replaced below */
      },
    };

    const interval = Math.max(50, opts.pollIntervalMs ?? DEFAULT_POLL_MS);
    const maxRead = Math.max(64 * 1024, opts.maxReadBytes ?? DEFAULT_MAX_READ);

    const onChange: fs.StatsListener = (curr, prev) => {
      void this.process(watcher, cbs, maxRead, curr, prev).catch((err) => {
        cbs.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    };

    fs.watchFile(filePath, { interval, persistent: true }, onChange);

    watcher.stop = (): void => {
      fs.unwatchFile(filePath, onChange);
      this.watchers.delete(id);
    };

    this.watchers.set(id, watcher);

    // If emitInitial is set, kick off a first read immediately so callers see
    // the existing content without waiting for the next poll tick.
    if (opts.emitInitial && stat.size > 0) {
      void this.process(watcher, cbs, maxRead, stat, stat).catch((err) => {
        cbs.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
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
    _prev: fs.Stats,
  ): Promise<void> {
    // Truncation / rotation: file shrank → restart from 0
    if (curr.size < w.lastSize) {
      w.offset = 0;
      w.carry = "";
      cbs.onRotated?.();
    }
    w.lastSize = curr.size;

    if (curr.size <= w.offset) return;

    const start = w.offset;
    const end = Math.min(curr.size, start + maxRead);
    const length = end - start;
    const fd = await fs.promises.open(w.filePath, "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fd.read(buf, 0, length, start);
      if (bytesRead <= 0) return;
      w.offset = start + bytesRead;
      const text = w.carry + buf.subarray(0, bytesRead).toString("utf8");
      const newlineIdx = text.lastIndexOf("\n");
      if (newlineIdx === -1) {
        // No newline yet → keep buffering. Cap the carry size to avoid OOM
        // for pathological inputs without line breaks.
        const MAX_CARRY = 1024 * 1024;
        w.carry = text.length > MAX_CARRY ? text.slice(-MAX_CARRY) : text;
        return;
      }
      const completePart = text.slice(0, newlineIdx);
      w.carry = text.slice(newlineIdx + 1);
      const lines = completePart
        .split("\n")
        .map((s) => (s.endsWith("\r") ? s.slice(0, -1) : s));
      // Drop empty last item from a trailing newline
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      if (lines.length > 0) cbs.onLines(lines);
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
