import { describe, expect, it } from "vitest";
import { projectToSlimEntries } from "../useFilterWorker";

describe("projectToSlimEntries", () => {
  const source = [
    {
      level: "INFO",
      logger: "test",
      thread: "main",
      message: "hello",
      timestamp: "2026-01-01T00:00:00Z",
      source: "file.log",
      mdc: { TraceID: "abc" },
      raw: { large: "ignored" },
    },
  ];

  it("omits MDC when diagnostic-context filtering is disabled", () => {
    const [projected] = projectToSlimEntries(source, undefined, false);

    expect(projected).not.toHaveProperty("mdc");
    expect(projected).not.toHaveProperty("raw");
  });

  it("includes MDC when diagnostic-context filtering is enabled", () => {
    const [projected] = projectToSlimEntries(source, undefined, true);

    expect(projected?.mdc).toEqual({ TraceID: "abc" });
  });
});
