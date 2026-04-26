import { describe, expect, it } from "vitest";
import {
  exportToCsv,
  exportToJson,
  exportToMarkdown,
  exportToNdjson,
  exportToTxt,
} from "../exportFormats";

const SAMPLE = [
  {
    timestamp: 1700000000000,
    level: "INFO",
    logger: "com.example.App",
    thread: "main",
    message: "Hello, world",
    source: "app.log",
    traceId: "abc",
    spanId: "01",
    _mark: "#ff0000",
  },
  {
    timestamp: 1700000001000,
    level: "ERROR",
    logger: "com.example.Db",
    thread: "io",
    message: 'Failed to connect: "timeout"\nat line 42',
    source: "app.log",
  },
] as const;

describe("exportFormats", () => {
  describe("exportToJson", () => {
    it("returns valid JSON containing all entries with markColor", () => {
      const out = exportToJson([...SAMPLE]);
      const parsed = JSON.parse(out) as Array<Record<string, unknown>>;
      expect(parsed).toHaveLength(2);
      expect(parsed[0]?.markColor).toBe("#ff0000");
      expect(parsed[1]?.markColor).toBe(null);
      expect(parsed[0]?.message).toBe("Hello, world");
    });
  });

  describe("exportToNdjson", () => {
    it("produces one JSON object per line, each parseable", () => {
      const out = exportToNdjson([...SAMPLE]);
      const lines = out.split("\n");
      expect(lines).toHaveLength(2);
      lines.forEach((l) => {
        expect(() => JSON.parse(l)).not.toThrow();
      });
      expect(out).not.toContain("\n\n");
    });
  });

  describe("exportToCsv", () => {
    it("starts with UTF-8 BOM and contains a header row", () => {
      const out = exportToCsv([...SAMPLE]);
      expect(out.charCodeAt(0)).toBe(0xfeff);
      const headerLine = out.slice(1).split("\n", 1)[0]!;
      expect(headerLine).toContain("timestamp");
      expect(headerLine).toContain("message");
    });

    it("escapes commas, quotes and newlines per RFC 4180", () => {
      const out = exportToCsv([...SAMPLE]);
      // The second message contains quotes + newline → must be wrapped & doubled.
      expect(out).toMatch(/"Failed to connect: ""timeout""\nat line 42"/);
    });
  });

  describe("exportToMarkdown", () => {
    it("renders a markdown table with header + separator + rows", () => {
      const out = exportToMarkdown([...SAMPLE], {
        exportedAt: "2026-01-01",
        total: 100,
      });
      expect(out).toContain("# Lumberjack Log Export");
      expect(out).toMatch(/\| Timestamp \| Level \| Logger \| Message \|/);
      expect(out).toMatch(/\| --- \| --- \| --- \| --- \|/);
      expect(out).toContain("Hello, world");
      // Newline inside cell must be replaced (not break table layout).
      expect(out).not.toMatch(/timeout"\nat line/);
    });

    it("escapes pipe characters in cells", () => {
      const out = exportToMarkdown([{ message: "a|b|c", level: "INFO" }]);
      expect(out).toContain("a\\|b\\|c");
    });
  });

  describe("exportToTxt", () => {
    it("uses the supplied timestamp formatter", () => {
      const out = exportToTxt([...SAMPLE], () => "TS");
      const lines = out.split("\n");
      // SAMPLE[1].message contains an embedded newline → 3 physical lines.
      expect(lines[0]).toBe("TS [INFO ] com.example.App - Hello, world");
      expect(lines).toHaveLength(3);
    });
  });
});
