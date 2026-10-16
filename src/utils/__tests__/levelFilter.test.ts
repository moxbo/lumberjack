import { describe, expect, it } from "vitest";
import { compileLevelFilter } from "../levelFilter";

describe("compileLevelFilter", () => {
  it.each(["", "ALL", "all", undefined, null])(
    "disables level filtering for %s",
    (level) => {
      expect(compileLevelFilter(level)).toBeNull();
    },
  );

  it("compiles a case-insensitive severity threshold", () => {
    expect(compileLevelFilter("warn")).toEqual(
      new Set(["WARN", "ERROR", "FATAL"]),
    );
  });

  it("keeps custom levels as exact case-insensitive matches", () => {
    expect(compileLevelFilter("notice")).toEqual(new Set(["NOTICE"]));
  });
});
