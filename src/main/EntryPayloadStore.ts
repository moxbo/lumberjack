import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGzip, gunzip } from "node:zlib";
import type { LogEntry } from "../types/ipc";
import { MESSAGE_PREVIEW_LENGTH } from "../utils/entryLimits";
import { estimatePayloadBytes } from "../utils/estimatePayloadBytes";
import { textChunks } from "../utils/textChunks";
import type { ExportOwner } from "./ExportFileService";
import { truncateEntryForRenderer } from "./util/logEntryUtils";

const RETAIN_THRESHOLD_BYTES = 256 * 1024;
const decompress = promisify(gunzip);

interface Payload {
  owner: ExportOwner;
  filePath: string;
  writing: Promise<void>;
}

interface Owner {
  references: Set<string>;
  closing: boolean;
  destroyed: () => void;
}

interface EntryPayloadStoreOptions {
  parentDirectory?: string;
  onCleanupError?: (error: unknown) => void;
}

function contextPreview(mdc: LogEntry["mdc"]): {
  mdc: LogEntry["mdc"];
  truncated: boolean;
} {
  if (!mdc) return { mdc, truncated: false };
  const preview: NonNullable<LogEntry["mdc"]> = {};
  let remaining = 32 * 1024;
  let count = 0;
  let truncated = false;
  for (const [key, value] of Object.entries(mdc)) {
    if (++count > 256 || key.length > remaining) {
      truncated = true;
      break;
    }
    remaining -= key.length;
    const text = String(value ?? "");
    const length = Math.min(2048, remaining);
    const clipped = text.length > length;
    Object.defineProperty(preview, key, {
      value: clipped ? text.slice(0, length) + "\u2026" : value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    remaining -= Math.min(text.length, length);
    truncated ||= clipped;
  }
  return { mdc: preview, truncated };
}

/** Originals live on disk; only previews and window-owned capabilities cross append IPC. */
export class EntryPayloadStore {
  private readonly payloads = new Map<string, Payload>();
  private readonly owners = new Map<ExportOwner, Owner>();
  private directory?: Promise<string>;
  private closed = false;
  private readonly onCleanupError: (error: unknown) => void;

  constructor(private readonly options: EntryPayloadStoreOptions = {}) {
    this.onCleanupError = options.onCleanupError ?? console.error;
  }

  async prepare(
    owner: ExportOwner,
    entries: readonly LogEntry[],
  ): Promise<LogEntry[]> {
    const result: LogEntry[] = [];
    const created: string[] = [];
    try {
      for (const entry of entries) {
        const prepared = await this.retain(owner, entry);
        result.push(prepared);
        if (prepared._payloadRef && prepared._payloadRef !== entry._payloadRef)
          created.push(prepared._payloadRef);
      }
      return result;
    } catch (error) {
      await this.release(owner, created);
      throw error;
    }
  }

  async retain(owner: ExportOwner, entry: LogEntry): Promise<LogEntry> {
    if (this.closed || owner.isDestroyed())
      throw new Error("Log payload window was closed");
    if (entry._payloadRef) {
      this.owned(owner, entry._payloadRef);
      return entry;
    }
    if (
      entry._fullMessage === undefined &&
      Number.isFinite(estimatePayloadBytes(entry, RETAIN_THRESHOLD_BYTES))
    )
      return entry;

    const normalized = truncateEntryForRenderer(entry);
    const fullMessage = entry._fullMessage ?? entry.message;
    const snapshot: LogEntry = {
      ...entry,
      mdc: normalized.mdc,
      message: fullMessage,
    };
    delete snapshot._fullMessage;
    delete snapshot._ingestionKind;
    delete snapshot._payloadRef;
    const serialized = JSON.stringify(snapshot);
    const directory = await this.getDirectory();
    if (this.closed || owner.isDestroyed())
      throw new Error("Log payload window was closed");
    const state = this.watchOwner(owner);
    if (state.closing) throw new Error("Log payload window was closed");
    const reference = randomUUID();
    const filePath = path.join(directory, `${reference}.json.gz`);
    const writing = pipeline(
      Readable.from(textChunks(serialized)),
      createGzip(),
      createWriteStream(filePath, { flags: "wx", mode: 0o600 }),
    );
    this.payloads.set(reference, { owner, filePath, writing });
    state.references.add(reference);
    try {
      await writing;
      if (state.closing || this.closed || owner.isDestroyed())
        throw new Error("Log payload window was closed");
    } catch (error) {
      await this.release(owner, [reference]);
      throw error;
    }

    const context = contextPreview(normalized.mdc);
    const alreadyPreviewed =
      entry._fullMessage !== undefined &&
      entry.message.length <= MESSAGE_PREVIEW_LENGTH + 256;
    const message = alreadyPreviewed
      ? entry.message
      : fullMessage.length > MESSAGE_PREVIEW_LENGTH
        ? fullMessage.slice(0, MESSAGE_PREVIEW_LENGTH) + "\u2026"
        : fullMessage;
    const preview: LogEntry = {
      timestamp: entry.timestamp,
      level: entry.level?.slice(0, 8192),
      logger: entry.logger?.slice(0, 8192),
      thread: entry.thread?.slice(0, 8192),
      source: entry.source,
      message,
      traceId: entry.traceId,
      spanId: entry.spanId,
      service: entry.service,
      mdc: context.mdc,
      mark: entry.mark,
      _mark: entry._mark,
      _payloadRef: reference,
      _messageSize: Buffer.byteLength(fullMessage, "utf8"),
      _truncated: entry._truncated === true || message !== fullMessage,
      _hasStack: Boolean(entry.stackTrace || entry.stack_trace),
    };
    if (context.truncated) preview._payloadMdcTruncated = true;
    if (entry.stackTrace && entry.stackTrace.length <= 2000)
      preview.stackTrace = entry.stackTrace;
    // Detach sliced strings so queued previews cannot pin complete input buffers.
    return structuredClone(preview);
  }

  async load(owner: ExportOwner, reference: string): Promise<LogEntry> {
    const payload = this.owned(owner, reference);
    await payload.writing;
    const decoded = await decompress(await readFile(payload.filePath));
    const entry: unknown = JSON.parse(decoded.toString("utf8"));
    if (
      !entry ||
      typeof entry !== "object" ||
      !("message" in entry) ||
      typeof entry.message !== "string" ||
      !("source" in entry) ||
      typeof entry.source !== "string" ||
      !("timestamp" in entry) ||
      !(
        entry.timestamp === null ||
        typeof entry.timestamp === "string" ||
        typeof entry.timestamp === "number"
      )
    )
      throw new Error("Invalid stored log payload");
    return entry as LogEntry;
  }

  async release(
    owner: ExportOwner,
    references: readonly string[],
  ): Promise<void> {
    for (const reference of references) {
      const payload = this.payloads.get(reference);
      if (payload && payload.owner !== owner)
        throw new Error("Log payload belongs to another window");
    }
    for (const reference of references) {
      const payload = this.payloads.get(reference);
      if (!payload) continue;
      // The producer reports write failures; partial files still need cleanup.
      await payload.writing.catch(() => undefined);
      try {
        await unlink(payload.filePath);
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "ENOENT"
        )
          throw error;
      }
      this.payloads.delete(reference);
      this.owners.get(owner)?.references.delete(reference);
    }
    this.unwatchEmptyOwner(owner);
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      [...this.owners.keys()].map((owner) => this.closeOwner(owner)),
    );
    if (this.directory) {
      const directory = await this.directory;
      await rm(directory, { recursive: true, force: true });
      this.directory = undefined;
    }
  }

  private getDirectory(): Promise<string> {
    if (this.directory) return this.directory;
    const opening = mkdtemp(
      path.join(
        this.options.parentDirectory ?? tmpdir(),
        "lumberjack-payloads-",
      ),
    );
    this.directory = opening;
    void opening.then(undefined, () => {
      if (this.directory === opening) this.directory = undefined;
    });
    return opening;
  }

  private owned(owner: ExportOwner, reference: string): Payload {
    if (this.closed || owner.isDestroyed() || this.owners.get(owner)?.closing)
      throw new Error("Log payload window was closed");
    const payload = this.payloads.get(reference);
    if (!payload) throw new Error("Original log payload is unavailable");
    if (payload.owner !== owner)
      throw new Error("Log payload belongs to another window");
    return payload;
  }

  private watchOwner(owner: ExportOwner): Owner {
    const existing = this.owners.get(owner);
    if (existing) return existing;
    const destroyed = () => {
      void this.closeOwner(owner).catch(this.onCleanupError);
    };
    const state: Owner = { references: new Set(), closing: false, destroyed };
    this.owners.set(owner, state);
    owner.once("destroyed", destroyed);
    owner.once("render-process-gone", destroyed);
    return state;
  }

  private async closeOwner(owner: ExportOwner): Promise<void> {
    const state = this.owners.get(owner);
    if (!state) return;
    state.closing = true;
    await this.release(owner, [...state.references]);
  }

  private unwatchEmptyOwner(owner: ExportOwner): void {
    const state = this.owners.get(owner);
    if (!state || state.references.size) return;
    owner.removeListener("destroyed", state.destroyed);
    owner.removeListener("render-process-gone", state.destroyed);
    this.owners.delete(owner);
  }
}

export const entryPayloadStore = new EntryPayloadStore();
