import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { EventEmitter } from "node:events";
import AdmZip from "adm-zip";
import type { LogEntry, Result, TcpStatus } from "../../types/ipc";
import type { WatcherCallbacks } from "../FileWatcher";
import type { HttpTailCallbacks } from "../HttpTailManager";
import { NetworkService } from "../../services/NetworkService";
import { SettingsService } from "../../services/SettingsService";
import { getSharedMainApi } from "../sharedMainApi";
import { registerIpcHandlers } from "../ipcHandlers";

class Sender extends EventEmitter {
  destroyed = false;
  send = vi.fn();
  constructor(readonly id: number) {
    super();
  }
  isDestroyed = () => this.destroyed;
  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

const fixture = vi.hoisted(() => ({
  ipc: { handle: vi.fn(), on: vi.fn() },
  windows: new Map<
    number,
    {
      id: number;
      webContents: Sender;
      isDestroyed: () => boolean;
    }
  >(),
  watchers: new Map<
    number,
    {
      id: number;
      filePath: string;
      callbacks: WatcherCallbacks;
    }
  >(),
  tails: new Map<
    number,
    {
      id: number;
      url: string;
      callbacks: HttpTailCallbacks;
    }
  >(),
  watchStart: vi.fn(),
  watchStop: vi.fn(),
  tailStart: vi.fn(),
  tailStop: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { on: vi.fn() },
  BrowserWindow: {
    fromWebContents: (sender: Sender) => fixture.windows.get(sender.id),
    fromId: (id: number) =>
      [...fixture.windows.values()].find((win) => win.id === id),
    getAllWindows: () => [...fixture.windows.values()],
  },
  dialog: {},
  Notification: {},
  safeStorage: {},
  ipcMain: fixture.ipc,
}));
vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../FileWatcher", () => ({
  WatchManager: class {
    start = fixture.watchStart;
    stop = fixture.watchStop;
    list = () =>
      [...fixture.watchers.values()].map(({ id, filePath }) => ({
        id,
        filePath,
      }));
    stopAll = () => fixture.watchers.clear();
  },
}));
vi.mock("../HttpTailManager", () => ({
  HttpTailManager: class {
    start = fixture.tailStart;
    stop = fixture.tailStop;
    list = () =>
      [...fixture.tails.values()].map(({ id, url }) => ({ id, url }));
    stopAll = () => fixture.tails.clear();
  },
}));

type SourceResult = Result<void> & { id: number };
type Poll = {
  url: string;
  consume?: Parameters<NetworkService["httpStartPoll"]>[3];
  onError?: Parameters<NetworkService["httpStartPoll"]>[2];
};
const sample: LogEntry = { timestamp: null, message: "line", source: "test" };
let network: NetworkService;
let startTcp: Mock<NetworkService["startTcpServer"]>;
let stopTcp: Mock<NetworkService["stopTcpServer"]>;
let startPoll: Mock<NetworkService["httpStartPoll"]>;
let stopPoll: Mock<NetworkService["httpStopPoll"]>;
let stopAllPolls: Mock<NetworkService["stopAllHttpPollers"]>;
let first: Sender;
let second: Sender;
let tcpOwner: number | null;
let tcpRunning: boolean;
let polls: Map<number, Poll>;
let enqueue: Mock<NonNullable<Parameters<typeof registerIpcHandlers>[5]>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createWindow(id: number) {
  const sender = new Sender(id);
  fixture.windows.set(id, {
    id: 100 + id,
    webContents: sender,
    isDestroyed: sender.isDestroyed,
  });
  return sender;
}

function invoke<T = Result<void>>(
  channel: string,
  sender: Sender,
  args?: unknown,
): Promise<T> {
  const callback = fixture.ipc.handle.mock.calls.find(
    ([name]) => name === channel,
  )![1] as (event: { sender: Sender }, args?: unknown) => T | Promise<T>;
  return Promise.resolve(callback({ sender }, args));
}

function send(channel: string, sender: Sender, args?: unknown): void {
  const callback = fixture.ipc.on.mock.calls.find(
    ([name]) => name === channel,
  )![1] as (event: { sender: Sender }, args?: unknown) => void;
  callback({ sender }, args);
}

function register(pollConsumer?: Parameters<typeof registerIpcHandlers>[8]) {
  fixture.ipc.handle.mockClear();
  fixture.ipc.on.mockClear();
  const settings = new SettingsService();
  vi.spyOn(settings, "save").mockResolvedValue(true);
  registerIpcHandlers(
    settings,
    network,
    () => ({
      parsePaths: () => [sample],
      parseTextLines: (source, text) =>
        text
          .split("\n")
          .map((message) => ({ timestamp: null, source, message })),
      parseJsonFile: () => [sample],
      fetchElasticPitPage: async () => ({
        entries: [sample],
        total: 1,
        hasMore: false,
        nextSearchAfter: null,
        pitSessionId: "pit-1",
      }),
      closeElasticPitSession: async () => {},
    }),
    () => AdmZip,
    undefined,
    enqueue,
    undefined,
    undefined,
    pollConsumer,
  );
}

async function startSources(sender: Sender) {
  const poll = await invoke<SourceResult>("http:startPoll", sender, {
    url: `http://example.test/${sender.id}`,
    intervalSec: 1,
  });
  const watch = await invoke<SourceResult>("watch:start", sender, {
    filePath: `/logs/${sender.id}.log`,
    emitInitial: true,
  });
  const tail = await invoke<SourceResult>("httpTail:start", sender, {
    url: `http://example.test/tail/${sender.id}`,
    emitInitial: true,
  });
  expect([poll.ok, watch.ok, tail.ok]).toEqual([true, true, true]);
  return { poll: poll.id, watch: watch.id, tail: tail.id };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.windows.clear();
  fixture.watchers.clear();
  fixture.tails.clear();
  let nextWatch = 1;
  let nextTail = 1;
  fixture.watchStart.mockImplementation(
    (filePath: string, callbacks: WatcherCallbacks) => {
      const watcher = { id: nextWatch++, filePath, callbacks };
      fixture.watchers.set(watcher.id, watcher);
      return watcher;
    },
  );
  fixture.watchStop.mockImplementation((id: number) =>
    fixture.watchers.delete(id),
  );
  fixture.tailStart.mockImplementation(
    (url: string, callbacks: HttpTailCallbacks) => {
      const tail = { id: nextTail++, url, callbacks };
      fixture.tails.set(tail.id, tail);
      return tail;
    },
  );
  fixture.tailStop.mockImplementation((id: number) => fixture.tails.delete(id));
  tcpOwner = null;
  tcpRunning = false;
  Object.assign(getSharedMainApi(), {
    getTcpOwnerWindowId: () => tcpOwner,
    setTcpOwnerWindowId: (id: number | null) => {
      tcpOwner = id;
    },
    getWindowCanTcpControl: () => true,
    applyWindowTitles: vi.fn(),
    updateAppMenu: vi.fn(),
  });
  first = createWindow(1);
  second = createWindow(2);
  polls = new Map();
  let nextPoll = 1;
  network = new NetworkService();
  vi.spyOn(network, "getTcpStatus").mockImplementation(() => ({
    ok: true,
    message: tcpRunning ? "running" : "stopped",
    running: tcpRunning,
  }));
  startTcp = vi
    .spyOn(network, "startTcpServer")
    .mockImplementation(async (port) => {
      tcpRunning = true;
      return { ok: true, running: true, message: "started", port };
    });
  stopTcp = vi.spyOn(network, "stopTcpServer").mockImplementation(async () => {
    tcpRunning = false;
    return { ok: true, running: false, message: "stopped" };
  });
  startPoll = vi
    .spyOn(network, "httpStartPoll")
    .mockImplementation(async (url, _interval, onError, consume) => {
      const id = nextPoll++;
      polls.set(id, { url, onError, consume });
      return { ok: true, id };
    });
  stopPoll = vi.spyOn(network, "httpStopPoll").mockImplementation((id) => ({
    ok: polls.delete(id),
  }));
  stopAllPolls = vi.spyOn(network, "stopAllHttpPollers");
  vi.spyOn(network, "httpLoadOnce").mockImplementation(
    async (_url, consume) => {
      await consume?.([sample]);
      return { ok: true, entries: [] };
    },
  );
  enqueue = vi.fn(async () => {});
  register();
});

describe("per-window live source pausing", () => {
  it("stops only owned sources, rejects paused restarts, and never autostarts on unpause", async () => {
    const own = await startSources(first);
    const other = await startSources(second);
    send("tcp:start", first, { port: 4000 });
    await vi.waitFor(() => expect(tcpRunning).toBe(true));
    await expect(invoke("live:setPaused", first, true)).resolves.toEqual({
      ok: true,
    });
    expect(stopTcp).toHaveBeenCalledOnce();
    expect(tcpOwner).toBeNull();
    expect(stopPoll).toHaveBeenCalledExactlyOnceWith(own.poll);
    expect(fixture.watchStop).toHaveBeenCalledExactlyOnceWith(own.watch);
    expect(fixture.tailStop).toHaveBeenCalledExactlyOnceWith(own.tail);
    expect(polls.has(other.poll)).toBe(true);
    expect(fixture.watchers.has(other.watch)).toBe(true);
    expect(fixture.tails.has(other.tail)).toBe(true);
    expect(stopAllPolls).not.toHaveBeenCalled();

    for (const [channel, args] of [
      ["http:startPoll", { url: "http://example.test/new", intervalSec: 1 }],
      ["watch:start", { filePath: "/logs/new.log" }],
      ["httpTail:start", { url: "http://example.test/new-tail" }],
    ] as const) {
      await expect(invoke(channel, first, args)).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining("paused"),
      });
    }
    send("tcp:start", first, { port: 4000 });
    await vi.waitFor(() =>
      expect(first.send).toHaveBeenCalledWith(
        "tcp:status",
        expect.objectContaining({
          ok: false,
          message: expect.stringContaining("paused"),
        }),
      ),
    );
    expect(startTcp).toHaveBeenCalledOnce();
    await expect(invoke("live:setPaused", first, false)).resolves.toEqual({
      ok: true,
    });
    expect(startTcp).toHaveBeenCalledOnce();
    expect(startPoll).toHaveBeenCalledTimes(2);
    expect(fixture.watchStart).toHaveBeenCalledTimes(2);
    expect(fixture.tailStart).toHaveBeenCalledTimes(2);
    await startSources(first);
  });

  it("does not reveal or stop another window's watchers, tails, pollers, or TCP server", async () => {
    const own = await startSources(first);
    await expect(invoke("watch:list", second)).resolves.toEqual({
      ok: true,
      watchers: [],
    });
    await expect(invoke("httpTail:list", second)).resolves.toEqual({
      ok: true,
      tails: [],
    });
    await expect(
      invoke("watch:stop", second, { id: own.watch }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      invoke("httpTail:stop", second, { id: own.tail }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      invoke("http:stopPoll", second, own.poll),
    ).resolves.toMatchObject({ ok: false });
    send("tcp:start", first, { port: 4000 });
    await vi.waitFor(() => expect(tcpRunning).toBe(true));
    send("tcp:stop", second);
    send("tcp:start", second, { port: 4001 });
    await expect(invoke("live:setPaused", second, true)).resolves.toEqual({
      ok: true,
    });
    expect(tcpOwner).toBe(101);
    expect(stopTcp).not.toHaveBeenCalled();
    expect(stopPoll).not.toHaveBeenCalled();
    expect(fixture.watchStop).not.toHaveBeenCalled();
    expect(fixture.tailStop).not.toHaveBeenCalled();
  });

  it("routes poll delivery to the origin and rejects stale callbacks after pause/unpause", async () => {
    const own = await startSources(second);
    const poll = polls.get(own.poll)!;
    await poll.consume!([sample]);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith([sample], second.id);
    await invoke("live:setPaused", second, true);
    await invoke("live:setPaused", second, false);
    await expect(poll.consume!([sample])).rejects.toThrow("paused");
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("never transfers TCP ownership on already-running or permission-denied starts", async () => {
    send("tcp:start", first, { port: 4000 });
    await vi.waitFor(() => expect(tcpRunning).toBe(true));
    send("tcp:start", first, { port: 4001 });
    send("tcp:start", second, { port: 4002 });
    await vi.waitFor(() =>
      expect(second.send).toHaveBeenCalledWith(
        "tcp:status",
        expect.objectContaining({
          ok: false,
          message: "TCP server already running",
        }),
      ),
    );
    expect(first.send).toHaveBeenLastCalledWith(
      "tcp:status",
      expect.objectContaining({ ok: false, running: true }),
    );
    getSharedMainApi().getWindowCanTcpControl = (id) => id === 101;
    second.send.mockClear();
    send("tcp:start", second, { port: 4003 });
    await vi.waitFor(() =>
      expect(second.send).toHaveBeenCalledWith(
        "tcp:status",
        expect.objectContaining({ ok: false }),
      ),
    );
    expect(tcpOwner).toBe(101);
    expect(startTcp).toHaveBeenCalledOnce();
    expect(stopTcp).not.toHaveBeenCalled();
  });

  it("removes source ownership after explicit stops", async () => {
    const own = await startSources(first);
    await expect(invoke("http:stopPoll", first, own.poll)).resolves.toEqual({
      ok: true,
    });
    await expect(
      invoke("watch:stop", first, { id: own.watch }),
    ).resolves.toEqual({ ok: true });
    await expect(
      invoke("httpTail:stop", first, { id: own.tail }),
    ).resolves.toEqual({ ok: true });
    await expect(invoke("watch:list", first)).resolves.toEqual({
      ok: true,
      watchers: [],
    });
    await expect(invoke("httpTail:list", first)).resolves.toEqual({
      ok: true,
      tails: [],
    });
    stopPoll.mockClear();
    fixture.watchStop.mockClear();
    fixture.tailStop.mockClear();
    await invoke("live:setPaused", first, true);
    expect(stopPoll).not.toHaveBeenCalled();
    expect(fixture.watchStop).not.toHaveBeenCalled();
    expect(fixture.tailStop).not.toHaveBeenCalled();
  });

  it("uses the dedicated poll consumer and waits for its required file logging", async () => {
    const disk = deferred<void>();
    const logged: LogEntry[] = [];
    register(async (entries, senderId) => {
      await disk.promise;
      logged.push(...entries);
      await enqueue(entries, senderId);
    });
    const own = await startSources(second);
    const consuming = polls.get(own.poll)!.consume!([sample]);
    expect(enqueue).not.toHaveBeenCalled();
    disk.resolve();
    await consuming;
    expect(logged).toEqual([sample]);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith([sample], second.id);
  });

  it("cancels pending HTTP starts even when unpause arrives before startup finishes", async () => {
    const started = deferred<{ ok: boolean; id: number }>();
    startPoll.mockReturnValueOnce(started.promise);
    const starting = invoke("http:startPoll", first, {
      url: "http://example.test/pending",
      intervalSec: 1,
    });
    const pausing = invoke("live:setPaused", first, true);
    const unpausing = invoke("live:setPaused", first, false);
    polls.set(99, { url: "http://example.test/pending" });
    started.resolve({ ok: true, id: 99 });
    await expect(starting).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("paused"),
    });
    await expect(pausing).resolves.toEqual({ ok: true });
    await expect(unpausing).resolves.toEqual({ ok: true });
    expect(stopPoll).toHaveBeenCalledExactlyOnceWith(99);
    expect(polls.size).toBe(0);
    expect(startPoll).toHaveBeenCalledOnce();
  });

  it("closes a TCP server that finishes starting after pause", async () => {
    const started =
      deferred<Required<Pick<TcpStatus, "ok" | "message" | "running">>>();
    startTcp.mockReturnValueOnce(started.promise);
    send("tcp:start", first, { port: 4000 });
    await vi.waitFor(() => expect(startTcp).toHaveBeenCalledOnce());
    expect(tcpOwner).toBe(101);
    const pausing = invoke("live:setPaused", first, true);
    const unpausing = invoke("live:setPaused", first, false);
    started.resolve({ ok: true, running: true, message: "started" });
    await expect(pausing).resolves.toEqual({ ok: true });
    await expect(unpausing).resolves.toEqual({ ok: true });
    expect(stopTcp).toHaveBeenCalledOnce();
    expect(tcpOwner).toBeNull();
    expect(first.send).not.toHaveBeenCalledWith(
      "tcp:status",
      expect.objectContaining({ running: true }),
    );
    expect(startTcp).toHaveBeenCalledOnce();
  });

  it("rejects a TCP start queued just before pause without ever opening the server", async () => {
    send("tcp:start", first, { port: 4000 });
    await invoke("live:setPaused", first, true);
    expect(startTcp).not.toHaveBeenCalled();
    expect(stopTcp).not.toHaveBeenCalled();
  });

  it("does not let an older unpause override a newer pause while TCP is stopping", async () => {
    send("tcp:start", first, { port: 4000 });
    await vi.waitFor(() => expect(tcpRunning).toBe(true));
    const stopped =
      deferred<Required<Pick<TcpStatus, "ok" | "message" | "running">>>();
    stopTcp.mockReturnValueOnce(stopped.promise);
    const pausing = invoke("live:setPaused", first, true);
    const unpausing = invoke("live:setPaused", first, false);
    const newerPause = invoke("live:setPaused", first, true);
    await vi.waitFor(() => expect(stopTcp).toHaveBeenCalledOnce());
    stopped.resolve({ ok: true, running: false, message: "stopped" });
    await Promise.all([pausing, unpausing, newerPause]);
    await expect(
      invoke("http:startPoll", first, {
        url: "http://example.test/new",
        intervalSec: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("paused"),
    });
    expect(startPoll).not.toHaveBeenCalled();
  });

  it("stops tail chunk parsing and watcher callbacks racing pause without restarting them", async () => {
    const own = await startSources(first);
    const watcher = fixture.watchers.get(own.watch)!;
    const tail = fixture.tails.get(own.tail)!;
    const accepted = deferred<void>();
    enqueue.mockReturnValue(accepted.promise);
    const delivering = tail.callbacks.onLines(
      Array.from({ length: 20_001 }, () => "line"),
    );
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
    await invoke("live:setPaused", first, true);
    await invoke("live:setPaused", first, false);
    accepted.resolve();
    await delivering;
    await watcher.callbacks.onLines(["stale"]);
    await tail.callbacks.onLines(["stale"]);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(fixture.watchers.size).toBe(0);
    expect(fixture.tails.size).toBe(0);
  });

  it("cleans destroyed owners and cancels their pending HTTP and TCP starts", async () => {
    const own = await startSources(first);
    const other = await startSources(second);
    const httpStarted = deferred<{ ok: boolean; id: number }>();
    startPoll.mockReturnValueOnce(httpStarted.promise);
    const httpStarting = invoke("http:startPoll", first, {
      url: "http://example.test/pending",
      intervalSec: 1,
    });
    const tcpStarted =
      deferred<Required<Pick<TcpStatus, "ok" | "message" | "running">>>();
    startTcp.mockReturnValueOnce(tcpStarted.promise);
    send("tcp:start", first, { port: 4000 });
    await vi.waitFor(() => expect(startTcp).toHaveBeenCalledOnce());
    first.destroy();
    polls.set(99, { url: "http://example.test/pending" });
    httpStarted.resolve({ ok: true, id: 99 });
    tcpStarted.resolve({ ok: true, running: true, message: "started" });
    await httpStarting;
    await vi.waitFor(() => expect(stopTcp).toHaveBeenCalledOnce());
    expect(polls.has(own.poll)).toBe(false);
    expect(polls.has(99)).toBe(false);
    expect(polls.has(other.poll)).toBe(true);
    expect(fixture.watchers.has(other.watch)).toBe(true);
    expect(fixture.tails.has(other.tail)).toBe(true);
    expect(tcpOwner).toBeNull();
    const replacement = createWindow(first.id);
    await startSources(replacement);
  });

  it("removes ownership when sources stop themselves after terminal errors", async () => {
    const own = await startSources(first);
    const watcher = fixture.watchers.get(own.watch)!;
    const tail = fixture.tails.get(own.tail)!;
    const poll = polls.get(own.poll)!;
    fixture.watchers.delete(own.watch);
    watcher.callbacks.onError!(new Error("watch failed"));
    tail.callbacks.onError!(new Error("tail failed"));
    fixture.tails.delete(own.tail);
    polls.delete(own.poll);
    poll.onError!(own.poll, new Error("poll failed"));
    await Promise.resolve();
    await invoke("live:setPaused", first, true);
    expect(stopPoll).not.toHaveBeenCalled();
    expect(fixture.watchStop).not.toHaveBeenCalled();
    expect(fixture.tailStop).not.toHaveBeenCalled();
  });

  it("keeps transient tail errors owned until explicitly stopped", async () => {
    const own = await startSources(first);
    fixture.tails.get(own.tail)!.callbacks.onError!(
      new Error("temporary outage"),
    );
    await Promise.resolve();
    await invoke("live:setPaused", first, true);
    expect(fixture.tailStop).toHaveBeenCalledExactlyOnceWith(own.tail);
  });

  it("reports cleanup failures while still attempting the other owned sources", async () => {
    await startSources(first);
    send("tcp:start", first, { port: 4000 });
    await vi.waitFor(() => expect(tcpRunning).toBe(true));
    stopPoll.mockReturnValue({
      ok: false,
      error: "poll stop failed",
    });
    fixture.watchStop.mockImplementation(() => {
      throw new Error("watch stop failed");
    });
    stopTcp.mockRejectedValue(new Error("TCP stop failed"));
    const result = await invoke("live:setPaused", first, true);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("poll stop failed");
    expect(result.error).toContain("watch stop failed");
    expect(result.error).toContain("TCP stop failed");
    expect(fixture.tailStop).toHaveBeenCalledOnce();
    await expect(
      invoke("httpTail:start", first, { url: "http://example.test/new" }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("paused"),
    });
  });

  it("keeps manual HTTP, raw file and Elasticsearch imports available while paused", async () => {
    await invoke("live:setPaused", first, true);
    await expect(
      invoke("http:loadOnce", first, "http://example.test/import"),
    ).resolves.toEqual({ ok: true, entries: [] });
    await expect(
      invoke("logs:parseRaw", first, [
        { name: "import.log", encoding: "utf8", data: "imported line" },
      ]),
    ).resolves.toEqual({ ok: true, entries: [] });
    expect(enqueue.mock.calls.map((call) => call.slice(1))).toEqual([
      [first.id, "import"],
      [first.id, "import"],
    ]);
    await expect(
      invoke("elastic:search", first, {
        url: "http://example.test:9200",
        index: "logs",
      }),
    ).resolves.toMatchObject({ ok: true, entries: [sample] });
    expect(startPoll).not.toHaveBeenCalled();
  });

  it("rejects invalid pause arguments without changing source admission", async () => {
    await expect(
      invoke("live:setPaused", first, "false"),
    ).resolves.toMatchObject({ ok: false });
    await startSources(first);
  });
});
