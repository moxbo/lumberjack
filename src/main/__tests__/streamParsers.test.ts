import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getStreamParseStrategy,
  parseTextLines,
  streamParseFile,
} from "../parsers";
import { streamPathsWithBackpressure } from "../ipcHandlers";

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

describe("streamParseFile", () => {
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
