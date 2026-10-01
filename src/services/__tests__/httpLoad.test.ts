import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkService } from "../NetworkService";
import { parseJsonFile, parseTextLines, toEntry } from "../../main/parsers";
import {
  DEFAULT_INGESTION_LIMITS,
  IngestionBudget,
} from "../../hooks/ingestionBudget";
import type { LogEntry } from "../../types/ipc";

vi.mock("electron-log/main", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(() => vi.restoreAllMocks());

function service() {
  const network = new NetworkService();
  const parse = vi.fn(parseTextLines);
  network.setParsers({ parseJsonFile, parseTextLines: parse, toEntry });
  return { network, parse };
}

describe("one-shot HTTP loading", () => {
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
