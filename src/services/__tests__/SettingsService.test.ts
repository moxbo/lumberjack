import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { app } from "electron";
import { SettingsService } from "../SettingsService";
import { DEFAULT_LIVE_ENTRY_LIMIT } from "../../utils/liveIngestionLimit";

vi.mock("electron", () => ({
  app: { getPath: vi.fn() },
  safeStorage: {},
}));
vi.mock("electron-log/main", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let directory: string;
let settingsPath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("PORTABLE_EXECUTABLE_DIR", "");
  directory = path.join(
    process.cwd(),
    `.settings-live-limit-test-${randomUUID()}`,
  );
  settingsPath = path.join(directory, "settings.json");
  await fs.promises.mkdir(directory);
  vi.spyOn(app, "getPath").mockReturnValue(directory);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.promises.rm(directory, { recursive: true, force: true });
});

describe("live entry limit validation", () => {
  it("uses the finite default and permits unrelated settings patches", () => {
    const service = new SettingsService();
    expect(SettingsService.getDefaults().liveEntryLimit).toBe(
      DEFAULT_LIVE_ENTRY_LIMIT,
    );
    expect(service.get().liveEntryLimit).toBe(DEFAULT_LIVE_ENTRY_LIMIT);
    expect(service.validate({ follow: true })).toEqual({ success: true });
  });

  it.each([1, 42, DEFAULT_LIVE_ENTRY_LIMIT, Number.MAX_SAFE_INTEGER])(
    "accepts positive safe integer %s",
    (liveEntryLimit) => {
      expect(new SettingsService().validate({ liveEntryLimit })).toEqual({
        success: true,
      });
    },
  );

  it.each([
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
    {},
    [],
  ])("explicitly rejects invalid limit %s", (value) => {
    const service = new SettingsService();
    expect(service.validate({ liveEntryLimit: value as number })).toEqual({
      success: false,
      error: `liveEntryLimit must be an integer between 1 and ${Number.MAX_SAFE_INTEGER}`,
    });
    expect(service.get().liveEntryLimit).toBe(DEFAULT_LIVE_ENTRY_LIMIT);
  });
});

describe.each(["sync", "async"] as const)(
  "live entry limit %s persistence",
  (mode) => {
    async function load(service: SettingsService): Promise<void> {
      if (mode === "sync") service.loadSync();
      else await service.load();
    }

    async function save(service: SettingsService): Promise<boolean> {
      return mode === "sync" ? service.saveSync() : service.save();
    }

    it.each([1, 73, DEFAULT_LIVE_ENTRY_LIMIT, Number.MAX_SAFE_INTEGER])(
      "persists and reloads the exact limit %s",
      async (liveEntryLimit) => {
        const service = new SettingsService();
        await load(service);
        service.update({ liveEntryLimit });
        expect(await save(service)).toBe(true);
        expect(
          JSON.parse(await fs.promises.readFile(settingsPath, "utf8")),
        ).toMatchObject({ liveEntryLimit });
        const restored = new SettingsService();
        await load(restored);
        expect(restored.get().liveEntryLimit).toBe(liveEntryLimit);
      },
    );

    it.each([
      undefined,
      null,
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      "500000",
    ])(
      "defaults missing or invalid stored limit %s without changing other settings",
      async (liveEntryLimit) => {
        await fs.promises.writeFile(
          settingsPath,
          JSON.stringify({ liveEntryLimit, follow: true, tcpPort: 6123 }),
        );
        const service = new SettingsService();
        await load(service);
        expect(service.get()).toMatchObject({
          liveEntryLimit: DEFAULT_LIVE_ENTRY_LIMIT,
          follow: true,
          tcpPort: 6123,
        });
        expect(await save(service)).toBe(true);
        expect(
          JSON.parse(await fs.promises.readFile(settingsPath, "utf8")),
        ).toMatchObject({
          liveEntryLimit: DEFAULT_LIVE_ENTRY_LIMIT,
          follow: true,
          tcpPort: 6123,
        });
      },
    );

    it("preserves a concurrent limit update when saving unrelated settings", async () => {
      const first = new SettingsService();
      const second = new SettingsService();
      await load(first);
      await load(second);
      first.update({ liveEntryLimit: 100 });
      second.update({ follow: true });
      expect(await save(first)).toBe(true);
      expect(await save(second)).toBe(true);
      expect(second.get()).toMatchObject({
        liveEntryLimit: 100,
        follow: true,
      });
    });
  },
);
