/**
 * Unit tests for buildElasticMessageQuery – übersetzt Message-Filter-Syntax
 * in eine Elasticsearch-Query.
 */
import { describe, it, expect } from "vitest";
import { buildElasticMessageQuery } from "../esMessageQuery";

// Hilfsfunktion: erzeugt den erwarteten query_string-Leaf für ein Einzel-Token.
const leaf = (value: string, field = "message"): Record<string, unknown> => ({
  query_string: {
    query: `${field}:*${value}*`,
    analyze_wildcard: true,
    allow_leading_wildcard: true,
  },
});

describe("buildElasticMessageQuery", () => {
  it("returns null for empty / whitespace expressions", () => {
    expect(buildElasticMessageQuery("")).toBeNull();
    expect(buildElasticMessageQuery("   ")).toBeNull();
  });

  it("builds a query_string query for a single token", () => {
    expect(buildElasticMessageQuery("error")).toEqual(leaf("error"));
  });

  it("uses match_phrase for quoted phrases (with whitespace)", () => {
    expect(buildElasticMessageQuery('"hello world"')).toEqual({
      match_phrase: { message: { query: "hello world" } },
    });
  });

  it("maps & / AND to bool.must", () => {
    const q = buildElasticMessageQuery("foo & bar");
    expect(q).toEqual({
      bool: {
        must: [leaf("foo"), leaf("bar")],
      },
    });
    // Textuelles AND ergibt dieselbe Struktur
    expect(buildElasticMessageQuery("foo AND bar")).toEqual(q);
  });

  it("maps | / OR to bool.should with minimum_should_match", () => {
    const q = buildElasticMessageQuery("foo | bar");
    expect(q).toEqual({
      bool: {
        should: [leaf("foo"), leaf("bar")],
        minimum_should_match: 1,
      },
    });
    expect(buildElasticMessageQuery("foo OR bar")).toEqual(q);
  });

  it("maps ! / NOT to bool.must_not", () => {
    expect(buildElasticMessageQuery("!foo")).toEqual({
      bool: {
        must_not: [leaf("foo")],
      },
    });
  });

  it("handles implicit AND for consecutive words", () => {
    const q = buildElasticMessageQuery("foo bar");
    expect(q).toEqual({
      bool: {
        must: [leaf("foo"), leaf("bar")],
      },
    });
  });

  it("respects parentheses / precedence: xml & (CB | AGV)", () => {
    expect(buildElasticMessageQuery("xml&(CB|AGV)")).toEqual({
      bool: {
        must: [
          leaf("xml"),
          {
            bool: {
              should: [leaf("CB"), leaf("AGV")],
              minimum_should_match: 1,
            },
          },
        ],
      },
    });
  });

  it("escapes query_string special characters in tokens", () => {
    expect(buildElasticMessageQuery("a*b?")).toEqual(leaf("a\\*b\\?"));
  });

  it("combines NOT with AND", () => {
    expect(buildElasticMessageQuery("foo & !bar")).toEqual({
      bool: {
        must: [
          leaf("foo"),
          {
            bool: {
              must_not: [leaf("bar")],
            },
          },
        ],
      },
    });
  });

  it("allows overriding the target field name", () => {
    expect(buildElasticMessageQuery("foo", "msg")).toEqual(leaf("foo", "msg"));
  });

  it("does not throw on operator-only expressions", () => {
    expect(() => buildElasticMessageQuery("&")).not.toThrow();
    expect(() => buildElasticMessageQuery("|")).not.toThrow();
    expect(() => buildElasticMessageQuery("!")).not.toThrow();
    expect(buildElasticMessageQuery("&")).toBeNull();
  });
});
