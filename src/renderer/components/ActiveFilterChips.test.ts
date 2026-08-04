import { describe, expect, it } from "vitest";
import { describeTimeFilter } from "./ActiveFilterChips";

const t = (key: string): string => key;

describe("describeTimeFilter", () => {
  it("shows the configured relative duration", () => {
    expect(
      describeTimeFilter(
        {
          enabled: true,
          mode: "relative",
          duration: "15m",
          from: null,
          to: null,
        },
        t,
      ),
    ).toBe("15m");
  });

  it("shows the configured absolute range", () => {
    expect(
      describeTimeFilter(
        {
          enabled: true,
          mode: "absolute",
          duration: "",
          from: "2026-08-04T06:00:00.000Z",
          to: "2026-08-04T07:00:00.000Z",
        },
        t,
      ),
    ).toBe("2026-08-04T06:00:00.000Z – 2026-08-04T07:00:00.000Z");
  });
});
