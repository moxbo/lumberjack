import { describe, expect, it } from "vitest";
import { httpLogBatches } from "../HttpLogStream";

async function* chunks(text: string, size: number) {
  const bytes = Buffer.from(text);
  for (let i = 0; i < bytes.length; i += size) {
    yield bytes.subarray(i, i + size);
  }
}

describe("HTTP log framing", () => {
  it.each([1, 7, 64 * 1024])(
    "frames nested JSON arrays with escaped strings and split UTF-8 (%i bytes)",
    async (size) => {
      const records = [
        {
          message: 'Unicode \u{1f600}, brackets ] [ and quote " \\',
          raw: [1, { a: [] }],
        },
        null,
        42,
        true,
        "string",
        [1, 2],
        { message: "last" },
      ];
      const received: unknown[] = [];
      for await (const batch of httpLogBatches(
        chunks(JSON.stringify(records, null, 2), size),
        1024,
        2,
      )) {
        expect(batch.jsonArray).toBe(true);
        received.push(...JSON.parse(batch.text));
      }
      expect(received).toEqual(records);
    },
  );

  it("preserves line whitespace, CRLF, split UTF-8 and the final suffix", async () => {
    const text = "  first \r\nsecond \u{1f600}\r\nlast";
    const batches = [];
    for await (const batch of httpLogBatches(chunks(text, 1), 1024, 2)) {
      batches.push(batch.text);
    }
    expect(batches).toEqual(["  first \nsecond \u{1f600}", "last"]);
  });

  it.each(["[]", " \n [ \n ] \n"])("accepts empty arrays: %s", async (text) => {
    const batches = [];
    for await (const batch of httpLogBatches(chunks(text, 1), 1024)) {
      batches.push(batch);
    }
    expect(batches).toEqual([]);
  });

  it.each([
    "[1,]",
    "[,1]",
    "[1",
    '[{"message":"unfinished',
    "[1]garbage",
    "[1 2]",
    "[{]}]",
  ])("rejects malformed or truncated arrays: %s", async (text) => {
    await expect(async () => {
      for await (const _batch of httpLogBatches(chunks(text, 1), 1024)) {
        // Drain to validate the entire response.
      }
    }).rejects.toThrow();
  });

  it.each(["x".repeat(11), '["' + "x".repeat(11) + '"]'])(
    "bounds an unfinished individual record",
    async (text) => {
      await expect(async () => {
        for await (const _batch of httpLogBatches(chunks(text, 1), 10)) {
          // Drain to trigger the per-record limit.
        }
      }).rejects.toThrow("record too large");
    },
  );
});
