import { describe, expect, it } from "vitest";
import { normalizeSettingsForm, settingsFormPatch } from "../settingsForm";
import { DEFAULT_LIVE_ENTRY_LIMIT } from "../liveIngestionLimit";

describe("settings form normalization", () => {
  it("uses the application's 4GB heap default and clears password edits", () => {
    expect(normalizeSettingsForm({})).toMatchObject({
      tcpPort: 5000,
      httpInterval: 5000,
      heapSizeMB: 4096,
      liveEntryLimit: DEFAULT_LIVE_ENTRY_LIMIT,
      elasticPassNew: "",
      elasticPassClear: false,
      themeMode: "system",
    });
    expect(
      normalizeSettingsForm({ elasticPassEnc: "encrypted", logMaxBackups: 0 }),
    ).toMatchObject({ elasticPassNew: "", logMaxBackups: 0 });
  });

  it.each([0, 65536, -1, 1.5, NaN, Infinity])(
    "rejects invalid TCP port %s",
    (tcpPort) => {
      expect(
        settingsFormPatch({ ...normalizeSettingsForm({}), tcpPort }),
      ).toBeNull();
    },
  );

  it.each([1, 42, DEFAULT_LIVE_ENTRY_LIMIT, Number.MAX_SAFE_INTEGER])(
    "preserves live entry limit %s on load and save",
    (liveEntryLimit) => {
      const form = normalizeSettingsForm({ liveEntryLimit });
      expect(form.liveEntryLimit).toBe(liveEntryLimit);
      expect(settingsFormPatch(form)?.liveEntryLimit).toBe(liveEntryLimit);
    },
  );

  it.each([
    undefined,
    null,
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
  ])(
    "defaults invalid persisted live entry limit %s but rejects it on save",
    (value) => {
      const liveEntryLimit = value as number;
      expect(normalizeSettingsForm({ liveEntryLimit }).liveEntryLimit).toBe(
        DEFAULT_LIVE_ENTRY_LIMIT,
      );
      expect(
        settingsFormPatch({
          ...normalizeSettingsForm({}),
          liveEntryLimit,
        }),
      ).toBeNull();
    },
  );

  it("normalizes all editable settings without overwriting unrelated features", () => {
    const patch = settingsFormPatch(
      {
        ...normalizeSettingsForm({}),
        tcpPort: 65535,
        httpUrl: " https://logs.test ",
        httpInterval: -1,
        logFilePath: " logs/output.log ",
        logMaxMB: 2.5,
        logMaxBackups: 0,
        themeMode: "invalid",
        elasticUrl: " https://elastic.test ",
        elasticUser: " user ",
        elasticSize: -5,
        elasticMaxParallel: 0,
        allowPrerelease: true,
        heapSizeMB: 99999,
        liveEntryLimit: 123456,
      },
      3,
    );
    expect(patch).toMatchObject({
      tcpPort: 65535,
      httpUrl: "https://logs.test",
      httpPollInterval: 1,
      logFilePath: "logs/output.log",
      logMaxBytes: 2.5 * 1024 * 1024,
      logMaxBackups: 0,
      themeMode: "system",
      elasticUrl: "https://elastic.test",
      elasticUser: "user",
      elasticSize: 1,
      elasticMaxParallel: 3,
      allowPrerelease: true,
      heapSizeMB: 8192,
      liveEntryLimit: 123456,
    });
    expect(patch).not.toHaveProperty("httpTailEmitInitial");
    expect(patch).not.toHaveProperty("marksMap");
    expect(patch).not.toHaveProperty("histAppName");
  });

  it.each([
    [1, 512],
    [0, 4096],
    [NaN, 4096],
    [8193, 8192],
  ])("clamps heap %s to %s on load and save", (heapSizeMB, expected) => {
    const form = normalizeSettingsForm({ heapSizeMB });
    expect(form.heapSizeMB).toBe(expected);
    expect(settingsFormPatch({ ...form, heapSizeMB })?.heapSizeMB).toBe(
      expected,
    );
  });

  it("preserves unchanged passwords and gives clear precedence over replacement", () => {
    const form = normalizeSettingsForm({});
    expect(settingsFormPatch(form)).not.toHaveProperty("elasticPassPlain");
    expect(
      settingsFormPatch({ ...form, elasticPassNew: " replacement " }),
    ).toMatchObject({ elasticPassPlain: "replacement" });
    const cleared = settingsFormPatch({
      ...form,
      elasticPassNew: "replacement",
      elasticPassClear: true,
    });
    expect(cleared).toMatchObject({ elasticPassClear: true });
    expect(cleared).not.toHaveProperty("elasticPassPlain");
  });
});
