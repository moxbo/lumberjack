import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { estimatePayloadBytes } from "../../utils/estimatePayloadBytes";
import { afterEach, describe, expect, it } from "vitest";
import type { LogEntry } from "../../types/ipc";
import {
  getStreamParseStrategy,
  parseJsonFile,
  parsePaths,
  parsePathsAsync,
  parseTextLines,
  streamParseFile,
} from "../parsers";
import {
  isJsonArrayLinePayload,
  streamPathsWithBackpressure,
} from "../ipcHandlers";

const FIXTURE_DIR = path.join(
  process.cwd(),
  "src",
  "main",
  "__tests__",
  "__stream-fixtures__",
);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeFixture(name: string, content: string): Promise<string> {
  await fs.promises.mkdir(FIXTURE_DIR, { recursive: true });
  const filePath = path.join(FIXTURE_DIR, name);
  await fs.promises.writeFile(filePath, content, "utf8");
  return filePath;
}

async function collectStreamEntries(
  filePath: string,
  chunkSize: number,
  highWaterMark?: number,
) {
  const chunks = [];
  for await (const chunk of streamParseFile(filePath, {
    chunkSize,
    highWaterMark,
  })) {
    chunks.push(chunk);
  }
  return chunks;
}

afterEach(async () => {
  await fs.promises.rm(FIXTURE_DIR, { recursive: true, force: true });
});

describe("isJsonArrayLinePayload", () => {
  it("detects arrays without joining a large line collection", () => {
    expect(
      isJsonArrayLinePayload(["", "   [", '{"message":"test"}', "]"]),
    ).toBe(true);
    expect(isJsonArrayLinePayload(['{"message":"test"}', ""])).toBe(false);
  });
});

describe("streamParseFile", () => {
  it("bounds parsed payload batches by bytes as well as count", async () => {
    const line = JSON.stringify({ message: "x".repeat(256 * 1024) });
    const filePath = await writeFixture(
      "byte-batches.log",
      `${line}\n`.repeat(8),
    );
    const chunks = await collectStreamEntries(filePath, 1000);
    expect(chunks.flatMap((chunk) => chunk.entries)).toHaveLength(8);
    expect(
      chunks.filter((chunk) => chunk.entries.length).length,
    ).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(
        chunk.entries.reduce(
          (sum, entry) => sum + estimatePayloadBytes(entry),
          0,
        ),
      ).toBeLessThanOrEqual(2 * 1024 * 1024);
    }
  });

  it("rejects oversized unbroken lines before accumulating a whole file", async () => {
    const filePath = await writeFixture(
      "oversized-line.log",
      "x".repeat(1024 * 1024 + 1),
    );
    await expect(collectStreamEntries(filePath, 1000)).rejects.toThrow("1 MiB");
  });

  it("preserves UTF-8 lines and final line without trailing newline", async () => {
    const content = [
      '{"message":"one"}',
      "2024-01-02T03:04:05Z plain äöü",
      '{"message":"emoji 😀"}',
      "tail",
    ].join("\n");
    const filePath = await writeFixture("utf8.log", content);

    const chunks = await collectStreamEntries(filePath, 2, 5);
    const streamed = chunks.flatMap((chunk) => chunk.entries);
    const expected = parseTextLines(filePath, content);

    expect(streamed).toEqual(expected);
    expect(chunks.map((chunk) => chunk.entries.length)).toEqual([2, 2, 0]);
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks[0]?.bytesRead).toBeGreaterThan(0);
    expect(chunks[0]?.bytesRead).toBeLessThanOrEqual(
      Buffer.byteLength(content),
    );
    expect(chunks.at(-1)?.bytesRead).toBe(Buffer.byteLength(content));
  });

  it("emits a final empty done chunk for exact chunk multiples", async () => {
    const content = ["a", "b", "c", "d"].join("\n");
    const filePath = await writeFixture("exact.log", content);

    const chunks = await collectStreamEntries(filePath, 2, 4);

    expect(chunks.map((chunk) => chunk.entries.length)).toEqual([2, 2, 0]);
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks.at(-1)?.bytesRead).toBe(Buffer.byteLength(content));
  });

  it("matches parseTextLines for malformed JSON and plain text", async () => {
    const content = [
      '{"message":"ok"}',
      '{"message":',
      "2024-05-01T12:00:00Z fallback line",
      '{"level":"INFO","message":"still ok"}',
    ].join("\n");
    const filePath = await writeFixture("malformed.log", content);

    const chunks = await collectStreamEntries(filePath, 3, 7);
    const streamed = chunks.flatMap((chunk) => chunk.entries);

    expect(streamed).toEqual(parseTextLines(filePath, content));
  });
});

describe("getStreamParseStrategy", () => {
  it("falls back for small files, JSON arrays, ZIPs, and unsupported extensions", async () => {
    const smallLog = await writeFixture("small.log", "line\n");
    const jsonArray = await writeFixture(
      "array.json",
      '[{"message":"one"},{"message":"two"}]',
    );
    const zipFile = await writeFixture("archive.zip", "not-a-real-zip");
    const binaryFile = await writeFixture("blob.bin", "0101");

    await expect(getStreamParseStrategy(smallLog, 1024)).resolves.toMatchObject(
      {
        streamable: false,
        reason: "small-file",
      },
    );
    await expect(getStreamParseStrategy(jsonArray, 1)).resolves.toMatchObject({
      streamable: false,
      reason: "json-array",
    });
    await expect(getStreamParseStrategy(zipFile, 1)).resolves.toMatchObject({
      streamable: false,
      reason: "unsupported-format",
    });
    await expect(getStreamParseStrategy(binaryFile, 1)).resolves.toMatchObject({
      streamable: false,
      reason: "unsupported-extension",
    });
  });
});

describe("streamPathsWithBackpressure", () => {
  it.each(["json", "zip"])(
    "imports a large %s fallback without bulk admission or argument-count overflow",
    async (extension) => {
      const count = 150_005;
      const text = JSON.stringify(
        Array.from({ length: count }, (_, index) => ({
          message: String(index),
          mdc: { tenant: "orders" },
          ...(index === 0 ? { markColor: "#ff0000" } : {}),
        })),
      );
      let filePath: string;
      if (extension === "zip") {
        const zip = new AdmZip();
        zip.addFile("logs.json", Buffer.from(text));
        filePath = await writeFixture("large.zip", "");
        await fs.promises.writeFile(filePath, zip.toBuffer());
      } else {
        filePath = await writeFixture("large.json", text);
      }
      let received = 0;
      let completed = false;
      await streamPathsWithBackpressure({
        sessionId: `large-${extension}`,
        filePaths: [filePath],
        parsers: {
          parsePaths,
          parsePathsAsync,
          parseJsonFile,
          parseTextLines,
          streamParseFile,
          getStreamParseStrategy,
        },
        sendChunk: async (chunk) => {
          expect(chunk.entries.length).toBeLessThanOrEqual(1000);
          expect(chunk.entries[0]?.message).toBe(String(received));
          expect(chunk.entries[0]?.mdc).toMatchObject({ tenant: "orders" });
          if (received === 0) expect(chunk.entries[0]?._mark).toBe("#ff0000");
          expect(chunk.entries.at(-1)?.message).toBe(
            String(received + chunk.entries.length - 1),
          );
          received += chunk.entries.length;
        },
        sendComplete: (result) => {
          expect(result.errors).toEqual([]);
          expect(result.totalEntries).toBe(count);
          completed = true;
        },
        sendError: (error) => {
          throw new Error(error.error);
        },
      });
      expect(received).toBe(count);
      expect(completed).toBe(true);
    },
  );

  it("bounds fallback batches by decoded bytes, not only entry count", async () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      timestamp: null,
      message: `${index}-${"x".repeat(256 * 1024)}`,
      source: "array.json",
    }));
    const batches: LogEntry[][] = [];
    await streamPathsWithBackpressure({
      sessionId: "byte-fallback",
      filePaths: ["array.json"],
      plans: [
        {
          filePath: "array.json",
          fileIndex: 0,
          totalBytes: 10,
          streamable: false,
        },
      ],
      parsers: {
        parsePaths: () => entries,
        parseJsonFile: parseTextLines,
        parseTextLines,
      },
      sendChunk: async (chunk) => {
        batches.push(chunk.entries);
        expect(
          chunk.entries.reduce(
            (sum, entry) => sum + estimatePayloadBytes(entry),
            64,
          ),
        ).toBeLessThanOrEqual(2 * 1024 * 1024);
      },
      sendComplete: (result) => {
        expect(result.errors).toEqual([]);
      },
      sendError: (error) => {
        throw new Error(error.error);
      },
    });
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(entries);
  });

  it("keeps file order and monotonic byte progress across multiple files", async () => {
    const streamedContent = Array.from(
      { length: 6 },
      (_, index) => `{"message":"stream-${String(index)}"}`,
    ).join("\n");
    const fallbackContent = ["small-1", "small-2"].join("\n");
    const streamedFile = await writeFixture("ordered.log", streamedContent);
    const fallbackFile = await writeFixture(
      "ordered-small.log",
      fallbackContent,
    );

    const seenMessages: string[] = [];
    const seenProgress: number[] = [];

    await streamPathsWithBackpressure({
      sessionId: "ordered-session",
      filePaths: [streamedFile, fallbackFile],
      parsers: {
        parsePaths: (paths: string[]) =>
          paths.flatMap((filePath) =>
            parseTextLines(filePath, fs.readFileSync(filePath, "utf8")),
          ),
        parseJsonFile: parseTextLines,
        parseTextLines,
        streamParseFile,
        getStreamParseStrategy,
      },
      thresholdBytes: 64,
      chunkSize: 3,
      sendChunk: async (chunk) => {
        seenProgress.push(chunk.bytesRead);
        seenMessages.push(
          ...chunk.entries.map((entry) => String(entry.message)),
        );
      },
      sendComplete: () => undefined,
      sendError: () => undefined,
    });

    expect(seenMessages).toEqual([
      "stream-0",
      "stream-1",
      "stream-2",
      "stream-3",
      "stream-4",
      "stream-5",
      "small-1",
      "small-2",
    ]);
    expect(seenProgress).toEqual([...seenProgress].sort((a, b) => a - b));
    expect(seenProgress.at(-1)).toBe(
      Buffer.byteLength(streamedContent) + Buffer.byteLength(fallbackContent),
    );
  });

  it("waits for acknowledgements before sending the next chunk", async () => {
    const content = Array.from(
      { length: 2500 },
      (_, index) => `line-${String(index)}`,
    ).join("\n");
    const filePath = await writeFixture("backpressure.log", content);

    const sentChunkIndices: number[] = [];
    const resolvers: Array<() => void> = [];
    let completed = false;

    const promise = streamPathsWithBackpressure({
      sessionId: "backpressure-session",
      filePaths: [filePath],
      parsers: {
        parsePaths: () => [],
        parseJsonFile: parseTextLines,
        parseTextLines,
        streamParseFile,
        getStreamParseStrategy,
      },
      thresholdBytes: 1,
      chunkSize: 1000,
      sendChunk: (chunk) => {
        sentChunkIndices.push(chunk.chunkIndex);
        return new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
      },
      sendComplete: () => {
        completed = true;
      },
      sendError: () => undefined,
    });

    await delay(50);
    expect(sentChunkIndices).toEqual([0]);

    resolvers.shift()?.();
    await delay(50);
    expect(sentChunkIndices).toEqual([0, 1]);

    resolvers.shift()?.();
    await delay(50);
    expect(sentChunkIndices).toEqual([0, 1, 2]);

    resolvers.shift()?.();
    await promise;
    expect(completed).toBe(true);
  });

  it("reports per-file errors on completion and continues remaining files", async () => {
    let completionErrors: string[] = [];
    const messages: string[] = [];

    await streamPathsWithBackpressure({
      sessionId: "error-session",
      filePaths: ["broken.log", "valid.log"],
      plans: [
        {
          filePath: "broken.log",
          fileIndex: 0,
          totalBytes: 10,
          streamable: true,
        },
        {
          filePath: "valid.log",
          fileIndex: 1,
          totalBytes: 10,
          streamable: false,
        },
      ],
      parsers: {
        parsePaths: () => [
          { timestamp: "", message: "valid", source: "valid.log" },
        ],
        parseJsonFile: parseTextLines,
        parseTextLines,
        getStreamParseStrategy: async () => ({
          streamable: true,
          totalBytes: 10,
          reason: "stream",
        }),
        streamParseFile: async function* () {
          yield* [];
          throw new Error("boom");
        },
      },
      sendChunk: async (chunk) => {
        messages.push(...chunk.entries.map((entry) => String(entry.message)));
      },
      sendComplete: (result) => {
        completionErrors = result.errors;
      },
      sendError: async () => undefined,
    });

    expect(messages).toEqual(["valid"]);
    expect(completionErrors).toEqual(["broken.log: boom"]);
  });
});
