import { afterEach, describe, expect, it, vi } from "vitest";
import { msgMatches } from "../../utils/msgFilter";
import {
  buildMessageSearchPage,
  decodeMessageSearchText,
  findMessageTerm,
  MAX_MESSAGE_SEARCH_CHARS,
  validateMessageSearchPage,
  type SearchableMessagePage,
} from "../../store/paged/messageSearchIndex";
import { MessagePageQuery, MessageTermCache } from "../messageSearch";

async function page(messages: string[]): Promise<SearchableMessagePage> {
  const result = await buildMessageSearchPage(
    1,
    messages.map((message, index) => ({
      id: index + 1,
      timestamp: index,
      message,
    })),
  );
  if (result.omitted) throw new Error("Expected a searchable page");
  validateMessageSearchPage(result);
  return result;
}

afterEach(() => vi.unstubAllGlobals());

describe("compact message search", () => {
  it("matches the existing permissive substring language, including Unicode", async () => {
    const messages = [
      "",
      "ERROR connection timeout",
      "warning",
      "error and or not",
      'quoted "message" C:\\logs',
      "foo bar baz",
      "foobar",
      "AND OR NOT",
      "Greek \u039f\u03a3",
      "\u0391",
      "\u0130stanbul",
      "lone \ud800 and \udc00",
      "\ud83d\ude00",
    ];
    const expressions = [
      "",
      "error",
      "err",
      "error timeout",
      "error AND NOT warning",
      "error OR warning",
      "!error",
      "!!error",
      "NOT (error OR warning)",
      "(error OR foo) AND NOT timeout",
      '"foo bar"',
      '""',
      '"quoted \\"message\\""',
      '"C:\\\\logs"',
      "and",
      "AND",
      "or",
      "not",
      "error OR",
      "error AND",
      "(",
      ")",
      "!",
      "error ) warning",
      "error AND OR warning",
      "(error OR",
      "error !",
      "error || warning",
      "\u03bf\u03c2",
      "\u0130",
      "\u0131",
      "\ud800",
      "\udc00",
      "\ud83d\ude00",
    ];
    const indexed = await page(messages);
    const cache = new MessageTermCache();
    for (const expression of expressions) {
      expect(
        [...(await new MessagePageQuery(expression).match(indexed, cache))],
        expression,
      ).toEqual(
        messages.map((message) => Number(msgMatches(message, expression))),
      );
    }
  });

  it("never matches across adjacent rows, including empty rows and overlaps", async () => {
    const indexed = await page(["abc", "", "def", "aaaa", "aa", ""]);
    const text = await decodeMessageSearchText(indexed);
    expect([...findMessageTerm(text, indexed.offsets, "cde")]).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
    expect([...findMessageTerm(text, indexed.offsets, "aaa")]).toEqual([
      0, 0, 0, 1, 0, 0,
    ]);
    expect([...findMessageTerm(text, indexed.offsets, "aa")]).toEqual([
      0, 0, 0, 1, 1, 0,
    ]);
    expect([...findMessageTerm(text, indexed.offsets, "")]).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it("preserves lone surrogates and per-message casing through compression", async () => {
    const messages = [
      "alpha \ud800 \udc00 \u0130 ".repeat(2_000),
      "\u039f\u03a3",
      "\u0391",
    ];
    const indexed = await page(messages);
    expect(indexed.text).toBeInstanceOf(Uint8Array);
    expect(await decodeMessageSearchText(indexed)).toBe(
      messages.map((message) => message.toLowerCase()).join(""),
    );
    expect([
      ...(await new MessagePageQuery("\u03bf\u03c2").match(
        indexed,
        new MessageTermCache(),
      )),
    ]).toEqual([0, 1, 0]);
  });

  it("stores plain text when native compression is unavailable", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const indexed = await page(["message ".repeat(4_000)]);
    expect(typeof indexed.text).toBe("string");
    expect(await decodeMessageSearchText(indexed)).toBe(
      "message ".repeat(4_000),
    );
  });

  it("uses bounded oversized markers and rejects invalid layouts/codecs", async () => {
    const oversized = await buildMessageSearchPage(1, [
      {
        id: 1,
        timestamp: null,
        message: "x".repeat(MAX_MESSAGE_SEARCH_CHARS + 1),
      },
    ]);
    expect(oversized).toMatchObject({ id: 1, omitted: true });
    expect("text" in oversized).toBe(false);
    const indexed = await page(["hello", "world"]);
    expect(() =>
      validateMessageSearchPage({ ...indexed, version: 999 }),
    ).toThrow("version");
    expect(() =>
      validateMessageSearchPage({ ...indexed, revision: "" }),
    ).toThrow("header");
    expect(() =>
      validateMessageSearchPage({
        ...indexed,
        offsets: new Uint32Array([0, 8, 5]),
      }),
    ).toThrow("boundaries");
    await expect(
      decodeMessageSearchText({ ...indexed, text: "short" }),
    ).rejects.toThrow("length");
    await expect(
      decodeMessageSearchText({ ...indexed, text: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow();
    await expect(buildMessageSearchPage(2, [])).rejects.toThrow("page ID");
    await expect(
      buildMessageSearchPage(1, [
        { id: 2, timestamp: null, message: "two" },
        { id: 1, timestamp: null, message: "one" },
      ]),
    ).rejects.toThrow("sorted");
  });

  it("reuses literal flags across boolean queries and invalidates changed pages", async () => {
    const indexed = await page(["Error warning", "error", "other"]);
    const cache = new MessageTermCache();
    await new MessagePageQuery("error OR warning").match(indexed, cache);
    // Cached terms must not need the text again.
    const withoutText = { ...indexed, text: new Uint8Array([0]) };
    expect([
      ...(await new MessagePageQuery("ERROR AND NOT warning").match(
        withoutText,
        cache,
      )),
    ]).toEqual([0, 1, 0]);
    const updated = await page(["other", "other", "error"]);
    expect([
      ...(await new MessagePageQuery("error").match(updated, cache)),
    ]).toEqual([0, 0, 1]);
    await expect(
      new MessagePageQuery("unseen").match(withoutText, cache),
    ).rejects.toThrow();
  });
});

describe("message term cache budget", () => {
  it("evicts the least recently used flags, accounts replacements, and clears", () => {
    const cache = new MessageTermCache(300);
    cache.put("r", "a", new Uint8Array([1]));
    cache.put("r", "b", new Uint8Array([2]));
    expect(cache.get("r", "a")).toEqual(new Uint8Array([1]));
    cache.put("r", "c", new Uint8Array([3]));
    expect(cache.get("r", "b")).toBeUndefined();
    expect(cache.get("r", "a")).toEqual(new Uint8Array([1]));
    cache.put("r", "a", new Uint8Array([4, 5]));
    expect(cache.get("r", "a")).toEqual(new Uint8Array([4, 5]));
    expect(cache.retainedBytes).toBeLessThanOrEqual(300);
    cache.put("r", "a", new Uint8Array(1_000));
    expect(cache.get("r", "a")).toBeUndefined();
    cache.put("r", "x".repeat(1_000), new Uint8Array([1]));
    expect(cache.retainedBytes).toBeLessThanOrEqual(300);
    cache.clear();
    expect(cache.retainedBytes).toBe(0);
    expect(cache.get("r", "c")).toBeUndefined();
  });
});
