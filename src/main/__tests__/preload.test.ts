import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI, LogEntry } from "../../types/ipc";
import { connect } from "net";
import { once } from "events";
import { NetworkService } from "../../services/NetworkService";
import { WindowAppendQueue } from "../../services/WindowAppendQueue";

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    invoke: vi.fn(async () => ({ ok: true, settings: {} })),
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
