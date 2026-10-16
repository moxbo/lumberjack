import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkService } from "../NetworkService";
import * as https from "https";
import { ClientRequest } from "http";
import { Readable } from "stream";
import { Socket } from "net";
import { parseJsonFile, parseTextLines, toEntry } from "../../main/parsers";
import {
  DEFAULT_INGESTION_LIMITS,
  IngestionBudget,
} from "../../hooks/ingestionBudget";
import type { LogEntry } from "../../types/ipc";

vi.mock("electron-log/main", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("https")>();
  return { ...actual, request: vi.fn(actual.request) };
});

afterEach(() => vi.restoreAllMocks());

function service() {
  const network = new NetworkService();
  const parse = vi.fn(parseTextLines);
  network.setParsers({ parseJsonFile, parseTextLines: parse, toEntry });
  return { network, parse };
}

describe("one-shot HTTP loading", () => {
  it.each(["text", "ndjson", "array"] as const)(
    "streams a %s response larger than the 20,142,521-byte issue payload",
    async (format) => {
      const message = "x".repeat(64 * 1024);
      const count = 310;
      const record = format === "text" ? message : JSON.stringify({ message });
      const bytes = Buffer.from(record + (format === "array" ? "," : "\n"));
      let pulls = 0;
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (format === "array" && pulls === 0) {
              controller.enqueue(Buffer.from("["));
            } else if (pulls < count + (format === "array" ? 1 : 0)) {
              const last = format === "array" && pulls === count;
              controller.enqueue(last ? Buffer.from(record + "]") : bytes);
            } else controller.close();
            pulls++;
          },
        },
        { highWaterMark: 0 },
      );
      expect(count * bytes.length).toBeGreaterThan(20142521);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, {
          headers: { "content-length": String(count * bytes.length) },
        }),
      );
      const { network } = service();
      let received = 0;
      const consume = vi.fn(async (entries: LogEntry[]) => {
        expect(entries.length).toBeLessThanOrEqual(100);
        for (const entry of entries) expect(entry.message).toBe(message);
        received += entries.length;
      });
      await expect(
        network.httpLoadOnce("http://example.test/log", consume),
      ).resolves.toEqual({ ok: true, entries: [] });
      expect(received).toBe(count);
      expect(network.getDiagnostics().http.maxResponseSize).toBeNull();
    },
  );

  it("does not pull more HTTP data while persistence is blocked", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(Buffer.from("line\n".repeat(100)));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    const { network } = service();
    let reject!: (error: Error) => void;
    const gate = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const consume = vi.fn(() => gate);
    const loading = network.httpLoadOnce("http://example.test/log", consume);
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    expect(pulls).toBe(1);
    reject(new Error("disk full"));
    await expect(loading).resolves.toEqual({ ok: false, error: "disk full" });
    expect(pulls).toBe(1);
    expect(cancelled).toBe(true);
  });

  it("does not count persistence backpressure toward the HTTP timeout", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("line\n".repeat(101)));
    const { network } = service();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const consume = vi.fn(() => gate);
    const loading = network.httpLoadOnce("http://example.test/log", consume);
    try {
      await vi.waitFor(() => expect(consume).toHaveBeenCalledOnce());
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(31_000);
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
      release();
    }
    await expect(loading).resolves.toEqual({ ok: true, entries: [] });
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it("streams native HTTPS with insecure TLS instead of accumulating the response", async () => {
    const url = "https://example.test/log";
    const message = "x".repeat(64 * 1024);
    const response = Readable.from(
      Array.from({ length: 310 }, () => Buffer.from(message + "\n")),
    );
    const request = new ClientRequest({
      hostname: "127.0.0.1",
      createConnection: () => new Socket(),
    });
    vi.spyOn(request, "end").mockImplementation(() => {
      queueMicrotask(() => request.emit("response", response));
      return request;
    });
    vi.spyOn(https, "request").mockReturnValue(request);
    const { network } = service();
    network.setAllowInsecureSSL(true);
    let received = 0;
    await expect(
      network.httpLoadOnce(url, async (entries) => {
        for (const entry of entries) expect(entry.message).toBe(message);
        received += entries.length;
      }),
    ).resolves.toEqual({ ok: true, entries: [] });
    expect(received).toBe(310);
    expect(request.destroyed).toBe(true);
    network.setAllowInsecureSSL(false);
  });

  it("loads more than the renderer entry limit in ACK-backed batches", async () => {
    const count = DEFAULT_INGESTION_LIMITS.maxEntries + 5;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        Array.from({ length: count }, (_, i) => `line-${i}`).join("\n"),
      ),
    );
    const { network, parse } = service();
    const budget = new IngestionBudget(DEFAULT_INGESTION_LIMITS);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let received = 0;
    const consume = vi.fn(async (entries: LogEntry[]) => {
      const free = budget.reserve(entries);
      try {
        expect(entries.length).toBeLessThanOrEqual(100);
        expect(entries[0]?.message).toBe(`line-${received}`);
        received += entries.length;
        await gate;
      } finally {
        free();
      }
    });
    const loading = network.httpLoadOnce("http://example.test/log", consume);
    try {
      await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
      expect(parse).toHaveBeenCalledTimes(1);
      expect(received).toBe(100);
    } finally {
      release();
    }
    await expect(loading).resolves.toEqual({ ok: true, entries: [] });
    expect(received).toBe(count);
    expect(consume).toHaveBeenCalledTimes(Math.ceil(count / 100));
  });

  it.each(["array", "ndjson", "text"] as const)(
    "preserves parser results and order for %s including the final suffix",
    async (format) => {
      const url = "http://example.test/log";
      const objects = Array.from({ length: 205 }, (_, i) => ({
        message: `message-${i} 😀`,
        timestamp: "2026-10-01T08:00:00.000Z",
        logger: "test",
      }));
      const text =
        format === "array"
          ? JSON.stringify(objects, null, 2)
          : format === "ndjson"
            ? objects.map((entry) => JSON.stringify(entry)).join("\r\n")
            : objects.map((entry) => entry.message).join("\r\n");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(text));
      const { network } = service();
      const received: LogEntry[] = [];
      const consume = vi.fn(async (entries: LogEntry[]) => {
        received.push(...entries);
      });
      await expect(network.httpLoadOnce(url, consume)).resolves.toEqual({
        ok: true,
        entries: [],
      });
      expect(received).toEqual(
        format === "text"
          ? parseTextLines(url, text)
          : parseJsonFile(url, text),
      );
      expect(consume.mock.calls.map(([entries]) => entries.length)).toEqual([
        100, 100, 5,
      ]);
    },
  );

  it("holds HTTP admission during persistence and releases it after failure", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("first\nlast"));
    const { network } = service();
    let reject!: (error: Error) => void;
    const gate = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const consume = vi.fn(() => gate);
    const requests = Array.from({ length: 4 }, () =>
      network.httpLoadOnce("http://example.test/log", consume),
    );
    await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(4));
    await expect(
      network.httpLoadOnce("http://example.test/log", consume),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("capacity"),
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    reject(new Error("disk full"));
    expect(await Promise.all(requests)).toEqual(
      Array.from({ length: 4 }, () => ({ ok: false, error: "disk full" })),
    );
    await expect(
      network.httpLoadOnce("http://example.test/log", async () => {}),
    ).resolves.toEqual({ ok: true, entries: [] });
  });

  it("stops on consumer failure without parsing or replaying the remaining suffix", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        Array.from({ length: 205 }, (_, i) => `line-${i}`).join("\n"),
      ),
    );
    const { network, parse } = service();
    const consume = vi.fn(async () => {
      throw new Error("persistence rejected");
    });
    await expect(
      network.httpLoadOnce("http://example.test/log", consume),
    ).resolves.toEqual({ ok: false, error: "persistence rejected" });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
  });
});
