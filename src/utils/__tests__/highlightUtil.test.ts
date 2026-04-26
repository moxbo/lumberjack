import { describe, expect, it } from "vitest";
import { clearRegexCache, escapeHtml, highlightAll } from "../highlight";

describe("highlight utility", () => {
  it("escapeHtml fast path keeps plain strings unchanged", () => {
    expect(escapeHtml("plain text 123")).toBe("plain text 123");
  });
  it("escapeHtml escapes special chars", () => {
    expect(escapeHtml("<script>&amp;")).toBe("&lt;script&gt;&amp;amp;");
  });
  it("escapeHtml handles non-strings", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(true)).toBe("true");
    expect(escapeHtml({})).toBe("");
  });
  it("highlightAll: empty needle escapes only", () => {
    expect(highlightAll("a<b>", "")).toBe("a&lt;b&gt;");
  });
  it("highlightAll: case-insensitive mark wrapping", () => {
    expect(highlightAll("Hello World hello", "hello")).toBe(
      "<mark>Hello</mark> World <mark>hello</mark>",
    );
  });
  it("highlightAll: escapes around matches", () => {
    expect(highlightAll("a<x>b", "x")).toBe("a&lt;<mark>x</mark>&gt;b");
  });
  it("highlightAll: regex meta chars are literal", () => {
    expect(highlightAll("foo.bar baz", ".")).toBe("foo<mark>.</mark>bar baz");
  });
  it("highlightAll: skips strings longer than 50k", () => {
    const out = highlightAll("a".repeat(50_001) + "needle", "needle");
    expect(out).not.toContain("<mark>");
  });
  it("clearRegexCache resets without errors", () => {
    highlightAll("abc", "a");
    expect(() => clearRegexCache()).not.toThrow();
    expect(highlightAll("abc", "c")).toBe("ab<mark>c</mark>");
  });
});
