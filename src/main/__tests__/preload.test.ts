import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI, LogEntry } from "../../types/ipc";
import { connect } from "net";
import { once } from "events";
import { NetworkService } from "../../services/NetworkService";
import { WindowAppendQueue } from "../../services/WindowAppendQueue";
import { LiveIngestionLimitError } from "../../utils/liveIngestionLimit";
import { prepareAppendBatch, renderBatches } from "../util/appendBatches";
import { onAppend } from "../../utils/typedApi";
import {
  getAppendFailureGroup,
  RendererBatchDeliveryError,
} from "../util/appendDelivery";

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  webUtils: { getPathForFile: vi.fn(() => "/logs/dropped.log") },
  ipcRenderer: {
    invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      ok: true,
      settings: {},
    })),
    on: vi.fn(),
    removeListener: vi.fn(),
    send: vi.fn(),
  },
}));
vi.mock("electron", () => electron);
vi.mock("electron-log/main", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
await import("../../../preload");
const api = electron.contextBridge.exposeInMainWorld.mock
  .calls[0]![1] as ElectronAPI;
const entry: LogEntry = {
  timestamp: null,
  message: "test",
  source: "tcp:test",
};

beforeEach(() => {
  electron.ipcRenderer.on.mockClear();
  electron.ipcRenderer.send.mockReset();
  electron.ipcRenderer.removeListener.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

function deliver(callback: Parameters<ElectronAPI["onAppend"]>[0]) {
  const cleanup = api.onAppend(callback);
  const listener = electron.ipcRenderer.on.mock.calls[0]![1] as (
    _event: unknown,
    payload: unknown,
  ) => void;
  listener({}, { batchId: "batch-1", entries: [entry] });
  return { cleanup, listener };
}

describe("renderer persistence acknowledgements", () => {
  it("exposes live pause control as an acknowledged IPC invocation", async () => {
    const result = { ok: false, error: "TCP stop failed" };
    electron.ipcRenderer.invoke.mockResolvedValueOnce(result);
    await expect(api.liveSetPaused(true)).resolves.toEqual(result);
    expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
      "live:setPaused",
      true,
    );
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ ok: true });
    await expect(api.liveSetPaused(false)).resolves.toEqual({ ok: true });
    expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
      "live:setPaused",
      false,
    );
  });

  it("resolves native dropped file paths with Electron webUtils", () => {
    const file = new File(["message"], "dropped.log");
    expect(api.getPathForFile(file)).toBe("/logs/dropped.log");
    expect(electron.webUtils.getPathForFile).toHaveBeenCalledWith(file);
  });

  it("propagates a preload negative ACK through the delivery queue to TCP disconnect", async () => {
    api.onAppend(async () => {
      throw new Error("storage quota exceeded");
    });
    const listener = electron.ipcRenderer.on.mock.calls[0]![1] as (
      _event: unknown,
      payload: unknown,
    ) => void;
    const queue = new WindowAppendQueue<LogEntry>();
    const network = new NetworkService();
    network.setParsers({
      parseJsonFile: () => [],
      parseTextLines: () => [],
      toEntry: (object, _fallback, source) => ({
        timestamp: null,
        message: String(object.message),
        source,
      }),
    });
    network.setLogCallback((entries) => {
      const receipt = queue.enqueue(entries);
      void queue
        .flush(
          async (blocks) => {
            await new Promise<void>((resolve, reject) => {
              electron.ipcRenderer.send.mockImplementation(
                (channel, payload) => {
                  if (channel !== "logs:appendAck") return;
                  if (payload.error) reject(new Error(payload.error));
                  else resolve();
                },
              );
              listener(
                {},
                {
                  batchId: "tcp-batch",
                  entries: [...blocks.batches(1000)].flat(),
                },
              );
            });
          },
          () => 0,
          false,
        )
        .catch(() => {});
      return receipt;
    });
    const status = await network.startTcpServer(0);
    const socket = connect({ port: status.port!, host: "127.0.0.1" });
    socket.on("error", () => {});
    socket.resume();
    try {
      await once(socket, "connect");
      const closed = new Promise<void>((resolve) =>
        socket.once("close", () => resolve()),
      );
      socket.write("rejected\n");
      await closed;
      expect(electron.ipcRenderer.send).toHaveBeenCalledExactlyOnceWith(
        "logs:appendAck",
        {
          batchId: "tcp-batch",
          error: "storage quota exceeded",
        },
      );
      expect(queue.isDisposed).toBe(true);
      expect(queue.length).toBe(0);
      expect(network.getTcpStatus().activeConnections).toBe(0);
    } finally {
      socket.destroy();
      await network.stopTcpServer();
      queue.dispose();
    }
  });

  it("preserves coalesced and subsequent imports when the consumer rejects a live-cap prefix", async () => {
    vi.stubGlobal("window", { api });
    const stored: string[] = [];
    let liveStored = 0;
    let capErrors = 0;
    const cleanup = onAppend((entries) => {
      if (entries[0]?._ingestionKind !== "import") {
        const allowed = entries.slice(0, Math.max(0, 1 - liveStored));
        stored.push(...allowed.map((item) => item.message));
        liveStored += allowed.length;
        capErrors++;
        throw new LiveIngestionLimitError(1, allowed.length);
      }
      stored.push(...entries.map((item) => item.message));
    });
    const listener = electron.ipcRenderer.on.mock.calls[0]![1] as (
      _event: unknown,
      payload: unknown,
    ) => void;
    const queue = new WindowAppendQueue<LogEntry>();
    let batchId = 0;
    const flush = () =>
      queue.flush(
        async (blocks) => {
          let acknowledged = 0;
          for (const block of blocks.batches(1000)) {
            for (const batch of renderBatches(block)) {
              await new Promise<void>((resolve, reject) => {
                electron.ipcRenderer.send.mockImplementation(
                  (channel, payload) => {
                    if (channel !== "logs:appendAck") return;
                    if (payload.error !== undefined)
                      reject(
                        new RendererBatchDeliveryError(
                          payload.error,
                          acknowledged,
                          getAppendFailureGroup(batch, payload.failureKind),
                        ),
                      );
                    else resolve();
                  },
                );
                listener(
                  {},
                  {
                    batchId: String(batchId++),
                    entries: prepareAppendBatch(batch),
                  },
                );
              });
              acknowledged += batch.length;
            }
          }
        },
        (error) =>
          error instanceof RendererBatchDeliveryError
            ? error.acknowledgedEntries
            : 0,
        false,
        (error) =>
          error instanceof RendererBatchDeliveryError
            ? error.isolatedFailureGroup
            : undefined,
      );
    const enqueue = (messages: string[], kind: "live" | "import") =>
      queue.enqueue(
        [
          ...renderBatches(
            messages.map((message) => ({ ...entry, message })),
            kind,
          ),
        ].flat(),
        8192,
        kind,
      );
    try {
      const receipts = [
        enqueue(["allowed-live", "overflow-live"], "live"),
        enqueue(["import-a", "import-b"], "import"),
        enqueue(["late-live"], "live"),
      ];
      const outcomes = Promise.allSettled(receipts);
      await flush();
      expect(await outcomes).toEqual([
        {
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringContaining("Live entry limit"),
          }),
        },
        { status: "fulfilled", value: undefined },
        {
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringContaining("Live entry limit"),
          }),
        },
      ]);
      expect(stored).toEqual(["allowed-live", "import-a", "import-b"]);
      expect(liveStored).toBe(1);
      expect(capErrors).toBe(1);
      expect(queue.isDisposed).toBe(false);
      expect(queue.length).toBe(0);

      await Promise.all([enqueue(["later-import"], "import"), flush()]);
      expect(stored).toEqual([
        "allowed-live",
        "import-a",
        "import-b",
        "later-import",
      ]);
      expect(electron.ipcRenderer.send.mock.calls).toEqual([
        [
          "logs:appendAck",
          {
            batchId: "0",
            error: new LiveIngestionLimitError(1, 1).message,
            failureKind: "live-entry-limit",
          },
        ],
        ["logs:appendAck", { batchId: "1" }],
        ["logs:appendAck", { batchId: "2" }],
      ]);
    } finally {
      queue.dispose();
      cleanup();
    }
  });

  it.each(["async", "sync"])(
    "sends only a negative ACK for %s consumer failure",
    async (kind) => {
      const failure = new Error("storage quota exceeded");
      deliver(
        kind === "async"
          ? async () => {
              throw failure;
            }
          : () => {
              throw failure;
            },
      );
      await vi.waitFor(() =>
        expect(electron.ipcRenderer.send).toHaveBeenCalledTimes(1),
      );
      expect(electron.ipcRenderer.send).toHaveBeenCalledWith("logs:appendAck", {
        batchId: "batch-1",
        error: "storage quota exceeded",
      });
    },
  );

  it("withholds success until persistence completes and removes its listener", async () => {
    let resolve!: () => void;
    const persisted = new Promise<void>((done) => {
      resolve = done;
    });
    const callback = vi.fn(() => persisted);
    const { cleanup, listener } = deliver(callback);
    await Promise.resolve();
    expect(callback).toHaveBeenCalledWith([entry]);
    expect(electron.ipcRenderer.send).not.toHaveBeenCalled();
    resolve();
    await vi.waitFor(() =>
      expect(electron.ipcRenderer.send).toHaveBeenCalledTimes(1),
    );
    expect(electron.ipcRenderer.send).toHaveBeenCalledWith("logs:appendAck", {
      batchId: "batch-1",
    });
    cleanup();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      "logs:append",
      listener,
    );
  });
});
