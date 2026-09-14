import { describe, expect, it } from "vitest";
import de from "../../locales/de.json";
import en from "../../locales/en.json";
import { filterProgressLabel } from "./FilterProgressStatus";

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
      "120.000 / 1.000.000 durchsucht · 347 Treffer",
    );
  });
  it("formats live English counts", () => {
    expect(filterProgressLabel(progress, true, "en", translator(en))).toBe(
      "120,000 / 1,000,000 searched · 347 matches",
    );
  });
  it("announces starting rather than no matches before the first page", () => {
    expect(filterProgressLabel(null, true, "de", translator(de))).toBe(
      "Suche wird gestartet …",
    );
    expect(filterProgressLabel(null, false, "de", translator(de))).toBe("");
  });
  it("reports the final match count after completion", () => {
    expect(
      filterProgressLabel(
        { ...progress, processed: progress.total },
        false,
        "en",
        translator(en),
      ),
    ).toBe("1,000,000 searched · 347 matches");
  });
});
