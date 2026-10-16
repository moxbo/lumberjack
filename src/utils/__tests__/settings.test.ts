import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_ENTRY_LIMIT } from "../liveIngestionLimit";
import {
  getDefaultSettings,
  mergeSettings,
  parseSettingsJSON,
  stringifySettingsJSON,
  validateSetting,
  validateSettings,
} from "../settings";

describe("live entry limit settings schema", () => {
  it("adds the finite default to new and legacy settings", () => {
    expect(getDefaultSettings().liveEntryLimit).toBe(DEFAULT_LIVE_ENTRY_LIMIT);
    expect(validateSettings({})).toMatchObject({
      settings: { liveEntryLimit: DEFAULT_LIVE_ENTRY_LIMIT },
      errors: [],
    });
    expect(parseSettingsJSON('{"_version":1,"tcpPort":5001}')).toMatchObject({
      success: true,
      settings: {
        tcpPort: 5001,
        liveEntryLimit: DEFAULT_LIVE_ENTRY_LIMIT,
      },
    });
  });

  it.each([undefined, null])(
    "uses the default for missing value %s per the settings convention",
    (value) => {
      expect(validateSetting("liveEntryLimit", value)).toEqual({
        valid: true,
        value: DEFAULT_LIVE_ENTRY_LIMIT,
      });
    },
  );

  it.each([1, 42, DEFAULT_LIVE_ENTRY_LIMIT, Number.MAX_SAFE_INTEGER])(
    "validates and serializes positive safe integer %s unchanged",
    (liveEntryLimit) => {
      expect(validateSetting("liveEntryLimit", liveEntryLimit)).toEqual({
        valid: true,
        value: liveEntryLimit,
      });
      const result = stringifySettingsJSON({ liveEntryLimit });
      expect(result.success).toBe(true);
      expect(parseSettingsJSON(result.json!)).toMatchObject({
        success: true,
        settings: { liveEntryLimit },
      });
    },
  );

  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "",
    "500000",
    true,
    {},
    [],
  ])("rejects invalid live entry limit %s", (value) => {
    expect(validateSetting("liveEntryLimit", value)).toMatchObject({
      valid: false,
      value: DEFAULT_LIVE_ENTRY_LIMIT,
      error: expect.stringContaining("liveEntryLimit"),
    });
  });

  it("preserves the current limit for unrelated and omitted patch values", () => {
    const current = { ...getDefaultSettings(), liveEntryLimit: 73 };
    for (const patch of [
      { tcpPort: 5001 },
      { liveEntryLimit: undefined },
      { liveEntryLimit: null },
    ]) {
      expect(mergeSettings(patch, current).liveEntryLimit).toBe(73);
    }
    expect(mergeSettings({ liveEntryLimit: 1 }, current).liveEntryLimit).toBe(
      1,
    );
  });
});
