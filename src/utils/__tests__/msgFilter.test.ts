/**
 * Unit tests for msgFilter – message filter expression parser/evaluator
 */
import { describe, it, expect } from "vitest";
import { msgMatches } from "../msgFilter";

describe("msgFilter – msgMatches", () => {
  describe("basic matching", () => {
    it("should return true for empty expression", () => {
      expect(msgMatches("hello world", "")).toBe(true);
    });

    it("should return true when word is found", () => {
      expect(msgMatches("hello world", "hello")).toBe(true);
    });

    it("should return false when word is not found", () => {
      expect(msgMatches("hello world", "foo")).toBe(false);
    });

    it("should be case-insensitive by default", () => {
      expect(msgMatches("Hello World", "hello")).toBe(true);
      expect(msgMatches("hello world", "HELLO")).toBe(true);
    });

    it("should handle null/undefined gracefully", () => {
      expect(msgMatches("", "")).toBe(true);
      expect(msgMatches("hello", "")).toBe(true);
    });
  });

  describe("AND operator (&)", () => {
    it("should match when both terms are present", () => {
      expect(msgMatches("hello world", "hello&world")).toBe(true);
    });

    it("should not match when one term is missing", () => {
      expect(msgMatches("hello world", "hello&foo")).toBe(false);
    });

    it("should support multiple AND terms", () => {
      expect(msgMatches("foo bar baz", "foo&bar&baz")).toBe(true);
      expect(msgMatches("foo bar", "foo&bar&baz")).toBe(false);
    });
  });

  describe("OR operator (|)", () => {
    it("should match when either term is present", () => {
      expect(msgMatches("hello world", "hello|foo")).toBe(true);
      expect(msgMatches("hello world", "foo|world")).toBe(true);
    });

    it("should not match when neither term is present", () => {
      expect(msgMatches("hello world", "foo|bar")).toBe(false);
    });

    it("should support multiple OR terms", () => {
      expect(msgMatches("hello world", "foo|bar|hello")).toBe(true);
    });
  });

  describe("NOT operator (!)", () => {
    it("should match when term is NOT present", () => {
      expect(msgMatches("hello world", "!foo")).toBe(true);
    });

    it("should not match when negated term IS present", () => {
      expect(msgMatches("hello world", "!hello")).toBe(false);
    });

    it("should handle double negation", () => {
      expect(msgMatches("hello world", "!!hello")).toBe(true);
    });

    it("should combine NOT with AND", () => {
      expect(msgMatches("hello world", "hello&!foo")).toBe(true);
      expect(msgMatches("hello world", "hello&!world")).toBe(false);
    });
  });

  describe("operator precedence (AND before OR)", () => {
    it("should evaluate AND before OR", () => {
      // "hello|foo&bar" should be "hello | (foo AND bar)"
      expect(msgMatches("hello world", "hello|foo&bar")).toBe(true);
      expect(msgMatches("foo bar", "hello|foo&bar")).toBe(true);
      expect(msgMatches("only foo", "hello|foo&bar")).toBe(false);
    });
  });

  describe("parentheses", () => {
    it("should override precedence with parentheses", () => {
      // "xml&(CB|AGV)" = xml AND (CB OR AGV)
      expect(msgMatches("xml CB data", "xml&(CB|AGV)")).toBe(true);
      expect(msgMatches("xml AGV data", "xml&(CB|AGV)")).toBe(true);
      expect(msgMatches("xml data", "xml&(CB|AGV)")).toBe(false);
    });

    it("should handle nested parentheses", () => {
      expect(msgMatches("a b c", "(a&(b|d))")).toBe(true);
      expect(msgMatches("a d", "(a&(b|d))")).toBe(true);
      expect(msgMatches("a e", "(a&(b|d))")).toBe(false);
    });

    it("should handle unbalanced parentheses gracefully", () => {
      // Should not crash, just be robust
      expect(msgMatches("hello", "(hello")).toBe(true);
      expect(msgMatches("hello", "hello)")).toBe(true);
    });
  });

  describe("escape sequences", () => {
    it("should treat escaped & as literal character", () => {
      expect(msgMatches("Tom&Jerry", "Tom\\&Jerry")).toBe(true);
      expect(msgMatches("TomJerry", "Tom\\&Jerry")).toBe(false);
    });

    it("should treat escaped | as literal character", () => {
      expect(msgMatches("A|B", "A\\|B")).toBe(true);
    });

    it("should treat escaped ! as literal character", () => {
      expect(msgMatches("!important", "\\!important")).toBe(true);
    });

    it("should treat escaped parentheses as literal", () => {
      expect(msgMatches("func()", "func\\(\\)")).toBe(true);
    });
  });

  describe("case-sensitive mode", () => {
    it("should be case-sensitive when specified", () => {
      expect(msgMatches("Hello World", "Hello", { mode: "sensitive" })).toBe(
        true,
      );
      expect(msgMatches("Hello World", "hello", { mode: "sensitive" })).toBe(
        false,
      );
    });

    it("should apply case-sensitivity to AND/OR operations", () => {
      expect(
        msgMatches("Hello World", "Hello&World", { mode: "sensitive" }),
      ).toBe(true);
      expect(
        msgMatches("Hello World", "hello&world", { mode: "sensitive" }),
      ).toBe(false);
    });
  });

  describe("regex mode", () => {
    it("should treat expression as regex", () => {
      expect(msgMatches("hello123", "hello\\d+", { mode: "regex" })).toBe(true);
      expect(msgMatches("hello", "hello\\d+", { mode: "regex" })).toBe(false);
    });

    it("should be case-insensitive in regex mode", () => {
      expect(msgMatches("HELLO", "hello", { mode: "regex" })).toBe(true);
    });

    it("should fallback to substring search for invalid regex", () => {
      // Invalid regex like "[unclosed" should not throw
      expect(msgMatches("[unclosed", "[unclosed", { mode: "regex" })).toBe(
        true,
      );
    });

    it("should handle empty regex expression", () => {
      expect(msgMatches("anything", "", { mode: "regex" })).toBe(true);
    });
  });

  describe("whitespace handling", () => {
    it("should ignore whitespace around operators", () => {
      expect(msgMatches("hello world", "hello & world")).toBe(true);
      expect(msgMatches("hello world", "hello | foo")).toBe(true);
    });

    it("should trim expression", () => {
      expect(msgMatches("hello", "  hello  ")).toBe(true);
    });

    it("should treat unquoted words as implicit AND", () => {
      expect(msgMatches("hello world", "hello world")).toBe(true);
      expect(msgMatches("hello world", "hello foo")).toBe(false);
      expect(msgMatches("foo bar baz", "foo baz")).toBe(true);
      expect(msgMatches("foo bar baz", "foo baz qux")).toBe(false);
    });
  });

  describe("quoted string (phrase search)", () => {
    it("should match exact phrase in quotes", () => {
      expect(msgMatches("hello world foo", '"hello world"')).toBe(true);
      expect(msgMatches("hello foo world", '"hello world"')).toBe(false);
    });

    it("should be case-insensitive for quoted strings", () => {
      expect(msgMatches("Hello World", '"hello world"')).toBe(true);
    });

    it("should support quoted phrase combined with AND operator", () => {
      expect(msgMatches("hello world foo", '"hello world"&foo')).toBe(true);
      expect(msgMatches("hello world foo", '"hello world"&bar')).toBe(false);
    });

    it("should support quoted phrase combined with OR operator", () => {
      expect(msgMatches("hello world", '"hello world"|bar')).toBe(true);
      expect(msgMatches("bar baz", '"hello world"|bar')).toBe(true);
      expect(msgMatches("foo baz", '"hello world"|bar')).toBe(false);
    });

    it("should support negated quoted phrase", () => {
      expect(msgMatches("hello world", '!"hello world"')).toBe(false);
      expect(msgMatches("hello foo", '!"hello world"')).toBe(true);
    });

    it("should handle unclosed quote gracefully", () => {
      expect(msgMatches("hello world", '"hello world')).toBe(true);
    });

    it("should handle empty quotes", () => {
      expect(msgMatches("hello", '""')).toBe(true);
    });

    it("should support quoted phrase with implicit AND", () => {
      expect(
        msgMatches("error: hello world happened", '"hello world" error'),
      ).toBe(true);
      expect(
        msgMatches("error: hello foo happened", '"hello world" error'),
      ).toBe(false);
    });
  });

  describe("textual operators (AND/OR/NOT)", () => {
    it("should treat uppercase AND as AND operator", () => {
      expect(msgMatches("hello world", "hello AND world")).toBe(true);
      expect(msgMatches("hello world", "hello AND foo")).toBe(false);
    });

    it("should treat uppercase OR as OR operator", () => {
      expect(msgMatches("hello world", "foo OR world")).toBe(true);
      expect(msgMatches("hello world", "foo OR bar")).toBe(false);
    });

    it("should treat uppercase NOT as NOT operator", () => {
      expect(msgMatches("hello world", "hello AND NOT foo")).toBe(true);
      expect(msgMatches("hello world", "hello AND NOT world")).toBe(false);
    });

    it("should combine textual operators with parentheses", () => {
      expect(msgMatches("xml CB data", "xml AND (CB OR AGV)")).toBe(true);
      expect(msgMatches("xml data", "xml AND (CB OR AGV)")).toBe(false);
    });

    it("should keep lowercase and/or as literal words (implicit AND)", () => {
      // "and" ist hier ein normales Wort -> hello AND and AND world
      expect(msgMatches("hello and world", "hello and world")).toBe(true);
      expect(msgMatches("hello world", "hello and world")).toBe(false);
    });

    it("should treat quoted AND/OR as literal phrase", () => {
      expect(msgMatches("foo AND bar", '"AND"')).toBe(true);
      expect(msgMatches("foo bar", '"AND"')).toBe(false);
    });

    it("should treat escaped AND as literal word", () => {
      expect(msgMatches("AND", "\\AND")).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle single character searches", () => {
      expect(msgMatches("a", "a")).toBe(true);
      expect(msgMatches("a", "b")).toBe(false);
    });

    it("should handle long expressions", () => {
      const msg = "alpha beta gamma delta epsilon";
      expect(msgMatches(msg, "alpha&beta&gamma&delta&epsilon")).toBe(true);
    });

    it("should handle expression with only operators", () => {
      // Edge case: expression with only & or | should not crash
      expect(() => msgMatches("hello", "&")).not.toThrow();
      expect(() => msgMatches("hello", "|")).not.toThrow();
      expect(() => msgMatches("hello", "!")).not.toThrow();
    });
  });
});
