/**
 * Unit tests for buildElasticMessageQuery – übersetzt Message-Filter-Syntax
 * in eine Elasticsearch-Query.
 */
import { describe, it, expect } from "vitest";
import { buildElasticMessageQuery } from "../esMessageQuery";

describe("buildElasticMessageQuery", () => {
  it("returns null for empty / whitespace expressions", () => {
    expect(buildElasticMessageQuery("")).toBeNull();
    expect(buildElasticMessageQuery("   ")).toBeNull();
  });

  it("builds a wildcard query for a single token", () => {
    expect(buildElasticMessageQuery("error")).toEqual({
      wildcard: {
        message: { value: "*error*", case_insensitive: true },
      },
    });
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
        must: [
          { wildcard: { message: { value: "*foo*", case_insensitive: true } } },
          { wildcard: { message: { value: "*bar*", case_insensitive: true } } },
        ],
      },
    });
    // Textuelles AND ergibt dieselbe Struktur
    expect(buildElasticMessageQuery("foo AND bar")).toEqual(q);
  });

  it("maps | / OR to bool.should with minimum_should_match", () => {
    const q = buildElasticMessageQuery("foo | bar");
    expect(q).toEqual({
      bool: {
        should: [
          { wildcard: { message: { value: "*foo*", case_insensitive: true } } },
          { wildcard: { message: { value: "*bar*", case_insensitive: true } } },
        ],
        minimum_should_match: 1,
      },
    });
    expect(buildElasticMessageQuery("foo OR bar")).toEqual(q);
  });

  it("maps ! / NOT to bool.must_not", () => {
    expect(buildElasticMessageQuery("!foo")).toEqual({
      bool: {
        must_not: [
          { wildcard: { message: { value: "*foo*", case_insensitive: true } } },
        ],
      },
    });
  });

  it("handles implicit AND for consecutive words", () => {
    const q = buildElasticMessageQuery("foo bar");
    expect(q).toEqual({
      bool: {
        must: [
          { wildcard: { message: { value: "*foo*", case_insensitive: true } } },
          { wildcard: { message: { value: "*bar*", case_insensitive: true } } },
        ],
      },
    });
  });

  it("respects parentheses / precedence: xml & (CB | AGV)", () => {
    expect(buildElasticMessageQuery("xml&(CB|AGV)")).toEqual({
      bool: {
        must: [
          { wildcard: { message: { value: "*xml*", case_insensitive: true } } },
          {
            bool: {
              should: [
                {
                  wildcard: {
                    message: { value: "*CB*", case_insensitive: true },
                  },
                },
                {
                  wildcard: {
                    message: { value: "*AGV*", case_insensitive: true },
                  },
                },
              ],
              minimum_should_match: 1,
            },
          },
        ],
      },
    });
  });

  it("escapes wildcard special characters in tokens", () => {
    expect(buildElasticMessageQuery("a*b?")).toEqual({
      wildcard: { message: { value: "*a\\*b\\?*", case_insensitive: true } },
    });
  });

  it("combines NOT with AND", () => {
    expect(buildElasticMessageQuery("foo & !bar")).toEqual({
      bool: {
        must: [
          { wildcard: { message: { value: "*foo*", case_insensitive: true } } },
          {
            bool: {
              must_not: [
                {
                  wildcard: {
                    message: { value: "*bar*", case_insensitive: true },
                  },
                },
              ],
            },
          },
        ],
      },
    });
  });

  it("allows overriding the target field name", () => {
    expect(buildElasticMessageQuery("foo", "msg")).toEqual({
      wildcard: { msg: { value: "*foo*", case_insensitive: true } },
    });
  });

  it("does not throw on operator-only expressions", () => {
    expect(() => buildElasticMessageQuery("&")).not.toThrow();
    expect(() => buildElasticMessageQuery("|")).not.toThrow();
    expect(() => buildElasticMessageQuery("!")).not.toThrow();
    expect(buildElasticMessageQuery("&")).toBeNull();
  });
});
