import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  EXPORT_CHUNK_BYTES,
  type ExportFormat,
  type ExportPathResult,
} from "../../types/ipc";
import {
  exportByteChunks,
  exportCurrentView,
  type ExportTransport,
} from "../exportCurrentView";
import { entrySignature } from "../entryUtils";
import {
  exportToCsv,
  exportToJson,
  exportToMarkdown,
  exportToNdjson,
  exportToTxt,
  streamExport,
  type ExportEntry,
} from "../exportFormats";
import { captureHtmlExportOptions } from "../htmlExport";
import { MetadataStore } from "../metadataSnapshot";
import type { PagedEntryMetadata } from "../../hooks/useEntryManagement";
import { InMemoryLogRepository } from "../../store/paged/InMemoryLogRepository";
import { ExportFileService } from "../../main/ExportFileService";

const sample: ExportEntry[] = [
  {
    timestamp: 1700000000000,
    level: "INFO",
    logger: "<logger>",
    message: 'A, "B"\nC|😀',
    _mark: "#ff0000",
    mdc: { x: [1, true] },
  },
  { timestamp: "later", level: "WARN", message: "second", stackTrace: "a\nb" },
];
const fmtTimestamp = (value: unknown): string => `TS(${String(value)})`;
const meta = { exportedAt: "2026-01-01", total: 100 };

async function collect(parts: AsyncIterable<string>): Promise<string> {
  let result = "";
  for await (const part of parts) result += part;
  return result;
}

function stubDom(): void {
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (key: string) =>
      key === "--color-bg-default" ? "#123456" : "",
  }));
}

function transport(format: ExportFormat = "ndjson") {
  const api = {
    chooseExportPath: vi.fn(async (): Promise<ExportPathResult> => ({
      ok: true,
      filePath: "/chosen/export",
      format,
    })),
    exportBegin: vi.fn(async () => ({
      ok: true as const,
      sessionId: "session",
    })),
    exportWrite: vi.fn(async (r: { chunkIndex: number }) => ({
      ok: true as const,
      chunkIndex: r.chunkIndex,
    })),
    exportFinish: vi.fn(async () => ({
      ok: true as const,
      filePath: "/chosen/export",
    })),
    exportCancel: vi.fn(async () => ({ ok: true as const })),
  } satisfies ExportTransport;
  return api;
}

function options(api: ExportTransport) {
  stubDom();
  return {
    ids: [1, 2],
    marks: {} as Record<string, string>,
    total: 100,
    locale: "de",
    t: (key: string) => key,
    fmtTimestamp,
    repository: {
      getPayloads: vi.fn(
        async (_ids: number[]) =>
          new Map([
            [1, sample[0]!],
            [2, sample[1]!],
          ]),
      ),
    },
    getDataGeneration: () => 0,
    api,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("incremental export formats", () => {
  it.each(["json", "ndjson", "csv", "md", "txt"] as const)(
    "matches existing %s output byte for byte",
    async (format) => {
      const legacy = {
        json: () => exportToJson(sample),
        ndjson: () => exportToNdjson(sample),
        csv: () => exportToCsv(sample),
        md: () => exportToMarkdown(sample, meta),
        txt: () => exportToTxt(sample, fmtTimestamp),
      };
      expect(
        await collect(
          streamExport(format, sample, {
            count: sample.length,
            ...meta,
            fmtTimestamp,
          }),
        ),
      ).toBe(legacy[format]());
    },
  );

  it.each(["json", "ndjson", "csv", "md", "txt"] as const)(
    "preserves empty %s output",
    async (format) => {
      const legacy = {
        json: () => exportToJson([]),
        ndjson: () => exportToNdjson([]),
        csv: () => exportToCsv([]),
        md: () => exportToMarkdown([], meta),
        txt: () => exportToTxt([], fmtTimestamp),
      };
      expect(
        await collect(
          streamExport(format, [], { count: 0, ...meta, fmtTimestamp }),
        ),
      ).toBe(legacy[format]());
    },
  );

  it("preserves HTML theme, labels, order and marks while escaping every cell", async () => {
    stubDom();
    const html = captureHtmlExportOptions(
      2,
      100,
      "de",
      (key) => `DE:${key}`,
      new Date(0),
    );
    const content = await collect(
      streamExport("html", sample, { count: 2, fmtTimestamp, html }),
    );
    expect(content).toContain('<html lang="de">');
    expect(content).toContain("background: #123456");
    expect(content).toContain("DE:list.header.timestamp");
    expect(content).toContain("DE:export.filteredOf");
    expect(content).toContain(
      "border-left: 4px solid #ff0000; background: #ff000022;",
    );
    expect(content).toContain("&lt;logger&gt;");
    expect(content).toContain("A, &quot;B&quot;\nC|😀");
    expect(content.indexOf("&lt;logger&gt;")).toBeLessThan(
      content.indexOf("second"),
    );
    expect(content).toMatch(/<\/html>$/);
  });

  it("fails rather than silently accepting entry count changes", async () => {
    await expect(
      collect(streamExport("json", sample, { count: 3, fmtTimestamp })),
    ).rejects.toThrow("count changed");
  });

  it("bounds UTF-8 chunks including oversized entries and surrogate pairs", async () => {
    const value = "a😀ä".repeat(50000);
    const source = async function* () {
      yield value;
      yield "END";
    };
    const chunks: Uint8Array[] = [];
    for await (const chunk of exportByteChunks(source())) {
      expect(chunk.byteLength).toBeGreaterThan(0);
      expect(chunk.byteLength).toBeLessThanOrEqual(EXPORT_CHUNK_BYTES);
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(2);
    expect(Buffer.concat(chunks).toString("utf8")).toBe(value + "END");
  });
});

describe("export orchestration", () => {
  it("retains bounded ID snapshots without copying the historical prefix", async () => {
    const api = transport();
    const opts = options(api);
    const store = new MetadataStore();
    const metadata = (id: number): PagedEntryMetadata =>
      ({
        _id: id,
        timestamp: id,
        source: "test",
      }) as PagedEntryMetadata;
    store.appendSorted([metadata(1), metadata(2)]);
    const ids = store.publish().ids;
    const iterate = vi.spyOn(ids, Symbol.iterator);
    api.chooseExportPath.mockImplementation(async () => {
      store.appendSorted([metadata(3)]);
      return { ok: true, filePath: "/chosen/export", format: "ndjson" };
    });
    expect(await exportCurrentView({ ...opts, ids })).toEqual({
      canceled: false,
      filePath: "/chosen/export",
      count: 2,
    });
    expect(iterate).not.toHaveBeenCalled();
    expect(opts.repository.getPayloads).toHaveBeenCalledWith([1, 2]);
  });

  describe("export data generation", () => {
    it.each([
      "dialog",
      "begin",
      "first-page",
      "last-page",
      "first-write",
      "last-write",
      "finish-in-flight",
    ] as const)(
      "handles clear/refill during %s without mixing generations",
      async (stage) => {
        const dir = path.resolve(`.export-generation-test-${randomUUID()}`);
        await mkdir(dir);
        const filePath = path.join(dir, "export.txt");
        const destination = "existing destination must survive";
        await writeFile(filePath, destination);
        const owner = Object.assign(new EventEmitter(), {
          isDestroyed: () => false,
        });
        const files = new ExportFileService();
        let sessionId: string | undefined;
        try {
          const repository = new InMemoryLogRepository();
          const entries = (prefix: string) =>
            Array.from({ length: 512 }, (_, index) => ({
              timestamp: index,
              message: `${prefix}-${index}-${"x".repeat(400)}`,
              source: "generation.log",
            }));
          const original = entries("old");
          const ids = await repository.putMany(original);
          let generation = 0;
          let replaced = false;
          const replace = async (): Promise<void> => {
            if (replaced) throw new Error("Dataset replaced more than once");
            replaced = true;
            generation++;
            await repository.clear();
            expect(await repository.putMany(entries("new"))).toEqual(ids);
          };
          const expected = exportToTxt(original, fmtTimestamp);
          const lastChunk =
            Math.ceil(Buffer.byteLength(expected) / EXPORT_CHUNK_BYTES) - 1;
          const getPayloads = repository.getPayloads.bind(repository);
          const reads = vi
            .spyOn(repository, "getPayloads")
            .mockImplementation(async (pageIds) => {
              const page = await getPayloads(pageIds);
              if (
                (stage === "first-page" && pageIds[0] === 1) ||
                (stage === "last-page" && pageIds[0] === 257)
              )
                await replace();
              return page;
            });
          const api = {
            chooseExportPath: vi.fn(async () => {
              files.authorize(owner, filePath);
              if (stage === "dialog") await replace();
              return { ok: true, filePath, format: "txt" as const };
            }),
            exportBegin: vi.fn(async () => {
              sessionId = await files.begin(owner, filePath);
              if (stage === "begin") await replace();
              return { ok: true as const, sessionId };
            }),
            exportWrite: vi.fn(
              async (
                request: Parameters<ExportTransport["exportWrite"]>[0],
              ) => {
                await files.write(
                  owner,
                  request.sessionId,
                  request.chunkIndex,
                  request.chunk,
                );
                if (
                  (stage === "first-write" && request.chunkIndex === 0) ||
                  (stage === "last-write" && request.chunkIndex === lastChunk)
                )
                  await replace();
                return { ok: true as const, chunkIndex: request.chunkIndex };
              },
            ),
            exportFinish: vi.fn(
              async (
                request: Parameters<ExportTransport["exportFinish"]>[0],
              ) => {
                if (stage === "finish-in-flight") await replace();
                await files.finish(
                  owner,
                  request.sessionId,
                  request.chunkCount,
                );
                return { ok: true as const, filePath };
              },
            ),
            exportCancel: vi.fn(
              async (
                request: Parameters<ExportTransport["exportCancel"]>[0],
              ) => {
                await files.cancel(owner, request.sessionId);
                return { ok: true as const };
              },
            ),
          } satisfies ExportTransport;
          const pending = exportCurrentView({
            ...options(api),
            ids,
            repository,
            getDataGeneration: () => generation,
          });
          if (stage === "finish-in-flight") {
            expect(await pending).toEqual({
              canceled: false,
              filePath,
              count: 512,
            });
            expect(await readFile(filePath, "utf8")).toBe(expected);
            expect(api.exportCancel).not.toHaveBeenCalled();
          } else {
            await expect(pending).rejects.toThrow("Export data changed");
            expect(api.exportBegin).toHaveBeenCalledOnce();
            expect(api.exportCancel).toHaveBeenCalledOnce();
            expect(api.exportFinish).not.toHaveBeenCalled();
            expect(await readFile(filePath, "utf8")).toBe(destination);
            if (stage === "dialog" || stage === "begin")
              expect(reads).not.toHaveBeenCalled();
            if (stage === "first-write") {
              expect(reads).toHaveBeenCalledTimes(1);
              expect(api.exportWrite).toHaveBeenCalledTimes(1);
            }
            if (stage === "last-write") {
              expect(reads).toHaveBeenCalledTimes(2);
              expect(api.exportWrite).toHaveBeenCalledTimes(lastChunk + 1);
            }
          }
          expect(replaced).toBe(true);
          expect(await readdir(dir)).toEqual(["export.txt"]);
        } finally {
          if (sessionId) await files.cancel(owner, sessionId);
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  });
  it("snapshots ids/marks before the dialog and preserves requested order", async () => {
    const api = transport("json");
    const opts = options(api);
    opts.ids = [2, 1];
    opts.marks[entrySignature(sample[0])] = "#00ff00";
    api.chooseExportPath.mockImplementation(async () => {
      opts.ids.reverse();
      opts.marks[entrySignature(sample[0])] = "#000000";
      return { ok: true, filePath: "/chosen/export", format: "json" };
    });
    const chunks: Uint8Array[] = [];
    api.exportWrite.mockImplementation(async (r) => {
      chunks.push((r as Parameters<ExportTransport["exportWrite"]>[0]).chunk);
      return { ok: true, chunkIndex: r.chunkIndex };
    });
    expect(await exportCurrentView(opts)).toEqual({
      canceled: false,
      filePath: "/chosen/export",
      count: 2,
    });
    expect(opts.repository.getPayloads).toHaveBeenCalledWith([2, 1]);
    const entries = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(entries.map((e: ExportEntry) => e.message)).toEqual([
      "second",
      sample[0]!.message,
    ]);
    expect(entries[1].markColor).toBe("#00ff00");
  });

  it("waits for each acknowledgement before producing the next chunk/page", async () => {
    const api = transport();
    const opts = options(api);
    opts.ids = Array.from({ length: 600 }, (_, i) => i + 1);
    opts.repository.getPayloads.mockImplementation(
      async (ids) =>
        new Map(
          ids.map((id) => [id, { message: "x".repeat(EXPORT_CHUNK_BYTES) }]),
        ),
    );
    let release!: () => void;
    let started!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.exportWrite.mockImplementationOnce(async (r) => {
      started();
      await blocked;
      return { ok: true, chunkIndex: r.chunkIndex };
    });
    const pending = exportCurrentView(opts);
    await writing;
    expect(api.exportWrite).toHaveBeenCalledTimes(1);
    expect(opts.repository.getPayloads).toHaveBeenCalledTimes(1);
    expect(opts.repository.getPayloads.mock.calls[0]![0]).toHaveLength(256);
    release();
    await pending;
    expect(opts.repository.getPayloads).toHaveBeenCalledTimes(3);
  });

  it("cancels and never finishes when a payload is missing", async () => {
    const api = transport();
    const opts = options(api);
    opts.repository.getPayloads.mockResolvedValue(new Map([[1, sample[0]!]]));
    await expect(exportCurrentView(opts)).rejects.toThrow(
      "payload missing for entry 2",
    );
    expect(api.exportCancel).toHaveBeenCalledWith({ sessionId: "session" });
    expect(api.exportFinish).not.toHaveBeenCalled();
  });

  it.each(["write", "finish", "ack", "repository"] as const)(
    "surfaces %s errors and cancels",
    async (kind) => {
      const api = transport();
      const opts = options(api);
      if (kind === "write")
        api.exportWrite.mockRejectedValue(new Error("disk full"));
      if (kind === "finish")
        api.exportFinish.mockRejectedValue(new Error("rename failed"));
      if (kind === "ack")
        api.exportWrite.mockResolvedValue({ ok: true, chunkIndex: 999 });
      if (kind === "repository")
        opts.repository.getPayloads.mockRejectedValue(new Error("DB failed"));
      await expect(exportCurrentView(opts)).rejects.toThrow();
      expect(api.exportCancel).toHaveBeenCalledOnce();
    },
  );

  it("surfaces cleanup failures together with the original error", async () => {
    const api = transport();
    const opts = options(api);
    api.exportWrite.mockRejectedValue(new Error("disk full"));
    api.exportCancel.mockRejectedValue(new Error("unlink failed"));
    await expect(exportCurrentView(opts)).rejects.toThrow(
      /disk full; export cleanup failed: Error: unlink failed/,
    );
  });

  it("cancels after an abort during a write without publishing success", async () => {
    const api = transport();
    const opts = options(api);
    const controller = new AbortController();
    api.exportWrite.mockImplementation(async (r) => {
      controller.abort();
      return { ok: true, chunkIndex: r.chunkIndex };
    });
    await expect(
      exportCurrentView({ ...opts, signal: controller.signal }),
    ).rejects.toThrow("Export canceled");
    expect(api.exportCancel).toHaveBeenCalledOnce();
    expect(api.exportFinish).not.toHaveBeenCalled();
  });

  it("does not begin a session when the save dialog is canceled", async () => {
    const api = transport();
    const opts = options(api);
    api.chooseExportPath.mockResolvedValue({ ok: false, error: "canceled" });
    expect(await exportCurrentView(opts)).toEqual({ canceled: true });
    expect(api.exportBegin).not.toHaveBeenCalled();
    expect(opts.repository.getPayloads).not.toHaveBeenCalled();
  });
});
