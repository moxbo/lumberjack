import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import AdmZip from "adm-zip";
import { parseJsonFile, parseTextLines } from "../parsers";
import type {
  ElasticSearchOptions,
  LogEntry,
  ParseResult,
} from "../../types/ipc";
import { SettingsService } from "../../services/SettingsService";
import { NetworkService } from "../../services/NetworkService";
import { registerIpcHandlers } from "../ipcHandlers";
import { IPC_BATCH_SIZE } from "../../constants/logViewer";
import {
  DEFAULT_INGESTION_LIMITS,
  IngestionBudget,
} from "../../hooks/ingestionBudget";

const ipc = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn() }));
vi.mock("electron", () => ({
  app: { on: vi.fn() },
  BrowserWindow: {},
  dialog: {},
  Notification: {},
  safeStorage: {},
  ipcMain: ipc,
}));
vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

afterEach(() => vi.useRealTimers());

type Parsers = ReturnType<Parameters<typeof registerIpcHandlers>[2]>;
function register(
  parsers: Partial<Parsers>,
  network = new NetworkService(),
  enqueue?: Parameters<typeof registerIpcHandlers>[5],
) {
  ipc.handle.mockClear();
  ipc.on.mockClear();
  registerIpcHandlers(
    new SettingsService(),
    network,
    () => parsers as Parsers,
    () => AdmZip,
    undefined,
    enqueue,
  );
}

describe("raw drop ingestion", () => {
  it("bounds decoded drop payload bytes even when the entry count is small", async () => {
    const budget = new IngestionBudget(DEFAULT_INGESTION_LIMITS);
    const entries = parseJsonFile(
      "large.json",
      JSON.stringify(
        Array.from({ length: 80 }, () => ({ message: "x".repeat(256 * 1024) })),
      ),
    );
    expect(() => budget.reserve(entries)).toThrow("capacity exceeded");
    let received = 0;
    const consume = vi.fn(async (batch: LogEntry[]) => {
      const release = budget.reserve(batch);
      received += batch.length;
      release();
    });
    register({ parseJsonFile: () => entries }, new NetworkService(), consume);
    const handler = ipc.handle.mock.calls.find(
      ([channel]) => channel === "logs:parseRaw",
    )![1];
    await expect(
      handler({ sender: { id: 42 } }, [
        { name: "large.json", encoding: "utf8", data: "[]" },
      ]),
    ).resolves.toEqual({ ok: true, entries: [] });
    expect(received).toBe(80);
    expect(consume.mock.calls.length).toBeGreaterThan(1);
  });

  it.each(["json", "ndjson", "txt", "zip"])(
    "persists large %s drops in bounded batches before returning success",
    async (extension) => {
      const count = DEFAULT_INGESTION_LIMITS.maxEntries + 5;
      const objects = Array.from({ length: count }, (_, index) => ({
        message: `entry-${index}`,
        mdc: { tenant: "orders" },
        ...(index === 0 ? { markColor: "#ff0000" } : {}),
      }));
      const json = JSON.stringify(objects);
      let data =
        extension === "json" || extension === "zip"
          ? json
          : extension === "txt"
            ? objects.map((entry) => entry.message).join("\n")
            : objects.map((entry) => JSON.stringify(entry)).join("\n");
      if (extension === "zip") {
        const zip = new AdmZip();
        zip.addFile("logs.json", Buffer.from(json));
        data = zip.toBuffer().toString("base64");
      }
      const budget = new IngestionBudget(DEFAULT_INGESTION_LIMITS);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let received = 0;
      const consume = vi.fn(async (entries: LogEntry[], senderId: number) => {
        const free = budget.reserve(entries);
        try {
          expect(senderId).toBe(42);
          expect(entries.length).toBeLessThanOrEqual(1000);
          expect(entries[0]?.message).toBe(`entry-${received}`);
          if (received === 0 && extension !== "txt") {
            expect(entries[0]?._mark).toBe("#ff0000");
            expect(entries[0]?.mdc).toMatchObject({ tenant: "orders" });
          }
          received += entries.length;
          await gate;
        } finally {
          free();
        }
      });
      register(
        { parseJsonFile, parseTextLines },
        new NetworkService(),
        consume,
      );
      const handler = ipc.handle.mock.calls.find(
        ([channel]) => channel === "logs:parseRaw",
      )![1];
      const loading = handler({ sender: { id: 42 } }, [
        {
          name: `drop.${extension}`,
          encoding: extension === "zip" ? "base64" : "utf8",
          data,
        },
      ]);
      try {
        await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
        expect(received).toBe(1000);
      } finally {
        release();
      }
      await expect(loading).resolves.toEqual({ ok: true, entries: [] });
      expect(received).toBe(count);
      expect(consume).toHaveBeenCalledTimes(Math.ceil(count / 1000));
    },
  );

  it("stops parsing later raw files after a negative persistence ACK", async () => {
    const parse = vi.fn(parseTextLines);
    const consume = vi.fn(async () => {
      throw new Error("storage quota exceeded");
    });
    register(
      { parseJsonFile, parseTextLines: parse },
      new NetworkService(),
      consume,
    );
    const handler = ipc.handle.mock.calls.find(
      ([channel]) => channel === "logs:parseRaw",
    )![1];
    await expect(
      handler({ sender: { id: 42 } }, [
        { name: "first.log", encoding: "utf8", data: "first\nlast" },
        { name: "next.log", encoding: "utf8", data: "next" },
      ]),
    ).resolves.toEqual({ ok: false, error: "storage quota exceeded" });
    expect(parse).toHaveBeenCalledExactlyOnceWith("first.log", "first\nlast");
    expect(consume).toHaveBeenCalledTimes(1);
  });
});

describe("terminal ingestion error notifications", () => {
  it.each(["json-array", "unsupported-format", "small-file"])(
    "streams %s fallback imports beyond renderer admission with ACK backpressure",
    async (reason) => {
      const count = DEFAULT_INGESTION_LIMITS.maxEntries + 5;
      const parse = vi.fn(async () =>
        Array.from({ length: count }, (_, index) => ({
          timestamp: null,
          message: `entry-${index}`,
          source: "fallback.json",
        })),
      );
      register({
        getStreamParseStrategy: async () => ({
          streamable: false,
          reason,
          totalBytes: 10,
        }),
        parsePathsAsync: parse,
      });
      const start = ipc.handle.mock.calls.find(
        ([channel]) => channel === "logs:streamParsePaths",
      )![1];
      const ready = ipc.on.mock.calls.find(
        ([channel]) => channel === "logs:streamReady",
      )![1];
      const ack = ipc.on.mock.calls.find(
        ([channel]) => channel === "logs:streamAck",
      )![1];
      const cancel = ipc.on.mock.calls.find(
        ([channel]) => channel === "logs:streamCancel",
      )![1];
      const budget = new IngestionBudget(DEFAULT_INGESTION_LIMITS);
      let received = 0;
      let blocked = true;
      const sender = Object.assign(new EventEmitter(), {
        id: 42,
        isDestroyed: () => false,
        send: vi.fn((channel: string, chunk) => {
          if (channel !== "logs:streamChunk") return;
          const release = budget.reserve(chunk.entries);
          expect(chunk.entries[0]?.message).toBe(`entry-${received}`);
          received += chunk.entries.length;
          release();
          if (!blocked) {
            queueMicrotask(() =>
              ack(
                { sender },
                {
                  sessionId: chunk.sessionId,
                  chunkIndex: chunk.chunkIndex,
                },
              ),
            );
          }
        }),
      });
      const result = await start({ sender }, ["fallback.json"]);
      expect(result).toMatchObject({ streamed: true });
      try {
        expect(parse).not.toHaveBeenCalled();
        ready({ sender }, { sessionId: result.sessionId });
        await vi.waitFor(() => expect(received).toBe(1000));
        expect(sender.send).toHaveBeenCalledTimes(1);
        blocked = false;
        ack({ sender }, { sessionId: result.sessionId, chunkIndex: 0 });
        await vi.waitFor(() =>
          expect(sender.send).toHaveBeenCalledWith(
            "logs:streamComplete",
            expect.objectContaining({ totalEntries: count, errors: [] }),
          ),
        );
        expect(received).toBe(count);
        expect(parse).toHaveBeenCalledExactlyOnceWith(["fallback.json"]);
      } finally {
        cancel({ sender }, { sessionId: result.sessionId });
      }
    },
  );

  it("routes one-shot HTTP batches to the requesting window and waits for persistence", async () => {
    const network = new NetworkService();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enqueue = vi.fn(() => gate);
    vi.spyOn(network, "httpLoadOnce").mockImplementation(
      async (_url, consume) => {
        await consume!([
          { timestamp: null, message: "HTTP entry", source: _url },
        ]);
        return { ok: true, entries: [] };
      },
    );
    register({}, network, enqueue);
    const handler = ipc.handle.mock.calls.find(
      ([channel]) => channel === "http:loadOnce",
    )![1];
    let completed = false;
    const loading = handler({ sender: { id: 42 } }, "http://example.test/log");
    void loading.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(
      [
        {
          timestamp: null,
          message: "HTTP entry",
          source: "http://example.test/log",
        },
      ],
      42,
    );
    release();
    await expect(loading).resolves.toEqual({ ok: true, entries: [] });
  });

  it("routes terminal polling errors to the requesting renderer", async () => {
    const network = new NetworkService();
    vi.spyOn(network, "httpStartPoll").mockImplementation(
      async (_url, _interval, onError) => {
        onError?.(7, new Error("ENOSPC"));
        return { ok: true, id: 7 };
      },
    );
    register({}, network);
    const sender = { isDestroyed: () => false, send: vi.fn() };
    const handler = ipc.handle.mock.calls.find(
      ([channel]) => channel === "http:startPoll",
    )![1];
    await handler(
      { sender },
      { url: "http://example.test/log", intervalSec: 1 },
    );
    expect(sender.send).toHaveBeenCalledExactlyOnceWith("http:pollError", {
      id: 7,
      url: "http://example.test/log",
      error: "ENOSPC",
    });
  });

  it.each(["ack-timeout", "ready-timeout", "send-failure", "cancel"] as const)(
    "ends a stream with correct notification and releases admission: %s",
    async (failure) => {
      vi.useFakeTimers();
      let parsed = 0;
      register({
        getStreamParseStrategy: async () => ({
          streamable: true,
          reason: "stream",
          totalBytes: 2 * 1024 * 1024,
        }),
        streamParseFile: async function* () {
          parsed++;
          yield {
            entries: [],
            bytesRead: 1,
            totalBytes: 2,
            filePath: "large.ndjson",
            done: false,
          };
          parsed++;
          yield {
            entries: [],
            bytesRead: 2,
            totalBytes: 2,
            filePath: "large.ndjson",
            done: true,
          };
        },
      });
      const sender = Object.assign(new EventEmitter(), {
        id: 1,
        isDestroyed: () => false,
        send: vi.fn((channel: string) => {
          if (channel === "logs:streamChunk" && failure === "send-failure")
            throw new Error("send failed");
        }),
      });
      const event = { sender };
      const start = ipc.handle.mock.calls.find(
        ([channel]) => channel === "logs:streamParsePaths",
      )![1];
      const ready = ipc.on.mock.calls.find(
        ([channel]) => channel === "logs:streamReady",
      )![1];
      const cancel = ipc.on.mock.calls.find(
        ([channel]) => channel === "logs:streamCancel",
      )![1];
      const { sessionId } = await start(event, ["large.ndjson"]);
      if (failure !== "ready-timeout") ready(event, { sessionId });
      await vi.advanceTimersByTimeAsync(0);
      if (failure === "cancel") cancel(event, { sessionId });
      await vi.advanceTimersByTimeAsync(30_000);
      const errors = sender.send.mock.calls.filter(
        ([channel]) => channel === "logs:streamError",
      );
      expect(errors).toHaveLength(failure === "cancel" ? 0 : 1);
      if (failure !== "cancel") {
        expect(errors[0]).toEqual([
          "logs:streamError",
          expect.objectContaining({
            sessionId,
            error: expect.stringMatching(
              failure === "send-failure" ? /send failed/ : /timed out/,
            ),
          }),
        ]);
      }
      expect(
        sender.send.mock.calls.some(
          ([channel]) => channel === "logs:streamComplete",
        ),
      ).toBe(false);
      expect(parsed).toBe(failure === "ready-timeout" ? 0 : 1);
      const next = await start(event, ["large.ndjson"]);
      expect(next.streamed).toBe(true);
      cancel(event, { sessionId: next.sessionId });
      await vi.advanceTimersByTimeAsync(0);
    },
  );
});

describe("Elastic producer admission", () => {
  it.each([1, 1000, 10_000])(
    "caps requested page size %i to one renderer admission batch",
    async (size) => {
      ipc.handle.mockClear();
      const fetchPage = vi.fn(async () => ({
        entries: [],
        total: 0,
        hasMore: false,
        nextSearchAfter: null,
        pitSessionId: "test",
      }));
      type Parsers = ReturnType<Parameters<typeof registerIpcHandlers>[2]>;
      registerIpcHandlers(
        new SettingsService(),
        new NetworkService(),
        () => ({ fetchElasticPitPage: fetchPage }) as unknown as Parsers,
        () => {
          throw new Error("ZIP parser unused");
        },
      );
      const handler = ipc.handle.mock.calls.find(
        ([channel]) => channel === "elastic:search",
      )![1] as (
        event: unknown,
        options: ElasticSearchOptions,
      ) => Promise<ParseResult>;
      await expect(
        handler({}, { url: "http://example.test", size }),
      ).resolves.toMatchObject({ ok: true, entries: [] });
      expect(fetchPage).toHaveBeenCalledWith(
        expect.objectContaining({ size: Math.min(size, IPC_BATCH_SIZE) }),
      );
    },
  );
});
