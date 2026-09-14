import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "events";
import { connect } from "net";
import { NetworkService } from "../NetworkService";

vi.mock("electron-log/main", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(() => vi.restoreAllMocks());

describe("source backpressure", () => {
  it("rejects an oversized chunked HTTP response without returning a truncated prefix", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(120);
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    const service = new NetworkService();
    const parse = vi.fn(() => []);
    service.setParsers({
      parseTextLines: parse,
      parseJsonFile: parse,
      toEntry: () => ({ timestamp: null, message: "", source: "" }),
    });
    await expect(
      service.httpLoadOnce("http://example.test/log"),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("too large"),
    });
    expect(parse).not.toHaveBeenCalled();
    expect(pulls).toBe(257);
    expect(cancelled).toBe(true);
  });

  const parsers = {
    parseJsonFile: () => [],
    parseTextLines: (_url: string, text: string) =>
      text
        .trim()
        .split("\n")
        .map((message) => ({ timestamp: null, message, source: _url })),
    toEntry: (
      entry: Record<string, unknown>,
      _fallback: string,
      source: string,
    ) => ({ timestamp: null, message: String(entry.message), source }),
  };

  it("pauses a TCP producer until persistence ACK and preserves the entire bulk suffix", async () => {
    const service = new NetworkService();
    const parse = vi.fn(parsers.toEntry);
    service.setParsers({ ...parsers, toEntry: parse });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received: string[] = [];
    const consume = vi.fn(async (entries: Array<{ message: string }>) => {
      received.push(...entries.map((entry) => entry.message));
      await blocked;
    });
    service.setLogCallback(consume);
    const status = await service.startTcpServer(0);
    const socket = connect({ port: status.port!, host: "127.0.0.1" });
    socket.resume();
    try {
      await once(socket, "connect");
      socket.write(
        Array.from(
          { length: 1000 },
          (_, i) => `${JSON.stringify({ message: String(i) })}\n`,
        ).join(""),
      );
      await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
      expect(parse).toHaveBeenCalledTimes(500);
      socket.write("last\n");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(parse).toHaveBeenCalledTimes(500);
      release();
      await vi.waitFor(() => expect(received.length).toBe(1001));
      expect(received).toEqual([
        ...Array.from({ length: 1000 }, (_, i) => String(i)),
        "last",
      ]);
    } finally {
      release();
      socket.destroy();
      await service.stopTcpServer();
    }
  });

  it("waits for an accepted TCP write when shutdown starts", async () => {
    const service = new NetworkService();
    service.setParsers(parsers);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const consume = vi.fn(() => blocked);
    service.setLogCallback(consume);
    const status = await service.startTcpServer(0);
    const socket = connect({ port: status.port!, host: "127.0.0.1" });
    socket.resume();
    await once(socket, "connect");
    socket.write("persist\n");
    await vi.waitFor(() => expect(consume).toHaveBeenCalled());
    let stopped = false;
    const stopping = service.stopTcpServer().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);
    release();
    await stopping;
    socket.destroy();
  });

  it("terminates TCP on consumer failure instead of discarding a suffix and continuing", async () => {
    const service = new NetworkService();
    service.setParsers(parsers);
    const consume = vi.fn(async () => {
      throw new Error("disk full");
    });
    service.setLogCallback(consume);
    const status = await service.startTcpServer(0);
    const socket = connect({ port: status.port!, host: "127.0.0.1" });
    socket.on("error", () => {});
    socket.resume();
    try {
      await once(socket, "connect");
      const closed = new Promise<void>((resolve) =>
        socket.once("close", () => resolve()),
      );
      socket.write("first\n");
      await closed;
      expect(consume).toHaveBeenCalledTimes(1);
      expect(service.getTcpStatus().activeConnections).toBe(0);
    } finally {
      socket.destroy();
      await service.stopTcpServer();
    }
  });

  it("bounds concurrent HTTP admission and does not download rejected requests", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => {
        await gate;
        return new Response("line\n");
      });
    const service = new NetworkService();
    service.setParsers(parsers);
    const requests = Array.from({ length: 4 }, () =>
      service.httpLoadOnce("http://example.test/log"),
    );
    await expect(
      service.httpLoadOnce("http://example.test/log"),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("capacity"),
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    release();
    expect((await Promise.all(requests)).every((result) => result.ok)).toBe(
      true,
    );
  });

  it("awaits every HTTP polling chunk and stops rather than replaying a terminal error", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () =>
          new Response(
            Array.from({ length: 201 }, (_, i) => `${i}\n`).join(""),
          ),
      );
    const service = new NetworkService();
    service.setParsers(parsers);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const consume = vi.fn(async () => {
      await gate;
      throw new Error("persistence failed");
    });
    service.setLogCallback(consume);
    const reportError = vi.fn();
    const poll = await service.httpStartPoll(
      "http://example.test/log",
      1,
      reportError,
    );
    try {
      await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
      expect(fetcher).toHaveBeenCalledTimes(1);
      release();
      await vi.waitFor(() =>
        expect(service.getDiagnostics().http.activePollers).toBe(0),
      );
      expect(consume).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledExactlyOnceWith(
        poll.id,
        expect.objectContaining({
          message: "persistence failed",
        }),
      );
    } finally {
      release();
      service.stopAllHttpPollers();
    }
  });
});
describe("TCP shutdown", () => {
  it.each([false, true])(
    "bounds shutdown and flushes trailing lines with allowHalfOpen=%s",
    async (allowHalfOpen) => {
      const service = new NetworkService();
      let parsed!: () => void;
      const receivedFirstLine = new Promise<void>((resolve) => {
        parsed = resolve;
      });
      const messages: string[] = [];
      service.setParsers({
        parseJsonFile: () => [],
        parseTextLines: () => [],
        toEntry: (entry, _fallback, source) => {
          parsed();
          return { timestamp: null, message: String(entry.message), source };
        },
      });
      service.setLogCallback((entries) => {
        messages.push(...entries.map((entry) => entry.message));
      });
      const status = await service.startTcpServer(0);
      expect(status.ok).toBe(true);
      const socket = connect({
        port: status.port!,
        host: "127.0.0.1",
        allowHalfOpen,
      });
      socket.resume();
      try {
        await once(socket, "connect");
        socket.write("complete\ntrailing");
        await receivedFirstLine;
        const schedule = vi.spyOn(globalThis, "setTimeout");
        const clear = vi.spyOn(globalThis, "clearTimeout");
        const started = performance.now();
        const stop = service.stopTcpServer();
        expect(service.stopTcpServer()).toBe(stop);
        const timerCall = schedule.mock.calls.findIndex(
          (args) => args[1] === 1000,
        );
        expect(timerCall).toBeGreaterThanOrEqual(0);
        const timer = schedule.mock.results[timerCall]!.value as NodeJS.Timeout;
        expect(timer.hasRef()).toBe(false);
        await expect(stop).resolves.toMatchObject({ ok: true, running: false });
        expect(performance.now() - started).toBeLessThan(2500);
        expect(clear).toHaveBeenCalledWith(timer);
        expect(service.getTcpStatus()).toMatchObject({
          running: false,
          activeConnections: 0,
        });
        // The stop promise must include socket cleanup, not just server.close.
        expect(messages).toEqual(["complete", "trailing"]);
        if (allowHalfOpen) expect(socket.writableEnded).toBe(false);
      } finally {
        socket.destroy();
        await service.stopTcpServer();
      }
    },
    4000,
  );
});
