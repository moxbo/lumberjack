import { describe, expect, it, vi } from "vitest";
import de from "../../locales/de.json";
import en from "../../locales/en.json";
import {
  FilterProgressStatus,
  filterProgressLabel,
} from "./FilterProgressStatus";

vi.mock("preact/hooks", () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(value: T) => [value, vi.fn()],
  useEffect: vi.fn(),
}));

function translator(messages: typeof de | typeof en) {
  return (key: string, params: Record<string, string> = {}) => {
    const name = key.split(".")[1] as keyof typeof messages.searchProgress;
    return messages.searchProgress[name].replace(
      /\{\{(\w+)\}\}/g,
      (_, param: string) => params[param] ?? "",
    );
  };
}

describe("filter progress labels", () => {
  const progress = { processed: 120_000, total: 1_000_000, matches: 347 };
  it("formats live German counts without declaring the search finished", () => {
    expect(filterProgressLabel(progress, true, "de", translator(de))).toBe(
      "120.000 / 1.000.000 durchsucht",
    );
  });
  it("formats live English counts", () => {
    expect(filterProgressLabel(progress, true, "en", translator(en))).toBe(
      "120,000 / 1,000,000 searched",
    );
  });
  it("announces starting rather than no matches before the first page", () => {
    expect(filterProgressLabel(null, true, "de", translator(de))).toBe(
      "Suche wird gestartet …",
    );
    expect(filterProgressLabel(null, false, "de", translator(de))).toBe("");
  });
  it("hides the entire status after completion instead of repeating counts", () => {
    expect(
      filterProgressLabel(
        { ...progress, processed: progress.total },
        false,
        "en",
        translator(en),
      ),
    ).toBe("");
    expect(
      FilterProgressStatus({
        progress,
        running: false,
        locale: "en",
        t: translator(en),
      }),
    ).toBeNull();
  });
});
