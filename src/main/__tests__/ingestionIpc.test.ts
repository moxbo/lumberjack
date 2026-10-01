import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ElasticSearchOptions, ParseResult } from "../../types/ipc";
import { SettingsService } from "../../services/SettingsService";
import { NetworkService } from "../../services/NetworkService";
import { registerIpcHandlers } from "../ipcHandlers";
import { IPC_BATCH_SIZE } from "../../constants/logViewer";

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
    () => {
      throw new Error("ZIP parser unused");
    },
    undefined,
    enqueue,
  );
}

describe("terminal ingestion error notifications", () => {
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
