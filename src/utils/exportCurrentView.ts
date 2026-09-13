import { EXPORT_CHUNK_BYTES, type ElectronAPI } from "../types/ipc";
import { entrySignature } from "./entryUtils";
import { streamExport, type ExportEntry } from "./exportFormats";
import { captureHtmlExportOptions, type ExportTranslate } from "./htmlExport";
import * as typedApi from "./typedApi";
import { EntryIdSnapshot, type ReadonlySequence } from "./metadataSnapshot";

export type ExportTransport = Pick<
  ElectronAPI,
  | "chooseExportPath"
  | "exportBegin"
  | "exportWrite"
  | "exportFinish"
  | "exportCancel"
>;

export interface ExportCurrentViewOptions {
  ids: ReadonlySequence<number>;
  marks: Readonly<Record<string, string>>;
  total: number;
  repository: {
    getPayloads(ids: number[]): Promise<ReadonlyMap<number, unknown>>;
  };
  /** Changes synchronously when the underlying dataset is cleared or replaced. */
  getDataGeneration: () => number;
  fmtTimestamp: (value: unknown) => string;
  locale: string;
  t: ExportTranslate;
  signal?: AbortSignal;
  /** Dependency injection for tests; normal callers use the typed preload API. */
  api?: ExportTransport;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Export canceled", "AbortError");
}

/** Pack UTF-8 bytes without splitting surrogate pairs during encoding. */
export async function* exportByteChunks(
  parts: AsyncIterable<string>,
  maxBytes = EXPORT_CHUNK_BYTES,
): AsyncGenerator<Uint8Array> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 4 ||
    maxBytes > EXPORT_CHUNK_BYTES
  ) {
    throw new RangeError("Invalid export chunk limit");
  }
  const encoder = new TextEncoder();
  let buffer = new Uint8Array(maxBytes);
  let used = 0;
  for await (const part of parts) {
    let offset = 0;
    while (offset < part.length) {
      let end = Math.min(offset + maxBytes, part.length);
      const last = part.charCodeAt(end - 1);
      if (end < part.length && last >= 0xd800 && last <= 0xdbff) end--;
      const { read, written } = encoder.encodeInto(
        part.slice(offset, end),
        buffer.subarray(used),
      );
      used += written;
      offset += read;
      if (used === maxBytes || read === 0) {
        yield buffer.slice(0, used);
        buffer = new Uint8Array(maxBytes);
        used = 0;
      }
    }
  }
  if (used) yield buffer.slice(0, used);
}

export async function exportCurrentView(
  options: ExportCurrentViewOptions,
): Promise<
  { canceled: true } | { canceled: false; filePath: string; count: number }
> {
  const { getDataGeneration, signal } = options;
  const generation = getDataGeneration();
  let invalidated = false;
  function checkSnapshot(): void {
    invalidated ||= getDataGeneration() !== generation;
    if (invalidated) {
      throw new Error(
        "Export data changed; the dataset was cleared or replaced",
      );
    }
    checkAbort(signal);
  }

  // Do this before opening the modal dialog: filters, order and marks can change
  // while it is open, and must never change halfway through an export.
  const ids =
    options.ids instanceof EntryIdSnapshot
      ? options.ids
      : Array.from(options.ids);
  const marks = { ...options.marks };
  const { total, locale, t, fmtTimestamp, repository } = options;
  const api = options.api ?? typedApi;
  if (!ids.length) throw new Error(t("errors.exportNoEntries"));
  checkSnapshot();
  const date = new Date();
  const html = captureHtmlExportOptions(ids.length, total, locale, t, date);
  const selected = await api.chooseExportPath();
  invalidated = getDataGeneration() !== generation;
  if (!selected.ok) {
    checkSnapshot();
    if (selected.error === "canceled") return { canceled: true };
    throw new Error(selected.error || "Export path selection failed");
  }
  if (!selected.filePath || !selected.format)
    throw new Error("Invalid export path response");

  // Begin even if cancellation/invalidation happened during the dialog, then cancel:
  // this consumes the one-shot path authorization and releases its owner listener.
  const begun = await api.exportBegin({ filePath: selected.filePath });
  if (!begun.ok) throw new Error(begun.error);
  if (!begun.sessionId) throw new Error("Invalid export session response");
  const sessionId = begun.sessionId;

  async function* entries(): AsyncGenerator<ExportEntry> {
    for (let start = 0; start < ids.length; start += 256) {
      checkSnapshot();
      const pageIds = ids.slice(start, start + 256);
      const page = await repository.getPayloads(pageIds);
      checkSnapshot();
      for (const id of pageIds) {
        checkSnapshot();
        const payload = page.get(id);
        if (!payload || typeof payload !== "object") {
          throw new Error(
            `Export payload missing for entry ${id}; the view may have been cleared`,
          );
        }
        const entry = payload as ExportEntry;
        const mark = marks[entrySignature(entry)] || entry._mark;
        yield mark ? { ...entry, _mark: mark } : entry;
        checkSnapshot();
      }
    }
  }

  try {
    checkSnapshot();
    const parts = streamExport(selected.format, entries(), {
      count: ids.length,
      total,
      exportedAt: date.toISOString(),
      fmtTimestamp,
      html,
    });
    let chunkIndex = 0;
    for await (const chunk of exportByteChunks(parts)) {
      checkSnapshot();
      const written = await api.exportWrite({ sessionId, chunkIndex, chunk });
      checkSnapshot();
      if (!written.ok) throw new Error(written.error);
      if (written.chunkIndex !== chunkIndex)
        throw new Error("Export acknowledgement mismatch");
      chunkIndex++;
    }
    checkSnapshot();
    const finished = await api.exportFinish({
      sessionId,
      chunkCount: chunkIndex,
    });
    // Once finish starts there are no more data reads; a later clear cannot
    // invalidate the fully serialized snapshot already submitted for commit.
    if (!finished.ok) throw new Error(finished.error);
    if (finished.filePath !== selected.filePath)
      throw new Error("Export destination mismatch");
    return { canceled: false, filePath: finished.filePath, count: ids.length };
  } catch (error) {
    try {
      const canceled = await api.exportCancel({ sessionId });
      if (!canceled.ok) throw new Error(canceled.error, { cause: error });
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; export cleanup failed: ${String(cleanupError)}`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
