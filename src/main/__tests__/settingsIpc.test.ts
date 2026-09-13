import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings, SettingsResult } from "../../types/ipc";
import { SettingsService } from "../../services/SettingsService";
import { NetworkService } from "../../services/NetworkService";
import { registerIpcHandlers } from "../ipcHandlers";

const handlers = vi.hoisted(() => ({
  settings: undefined as
    | ((event: unknown, patch: Partial<Settings>) => Promise<SettingsResult>)
    | undefined,
  relaunch: undefined as (() => Promise<{ ok: boolean }>) | undefined,
  restart: vi.fn(),
  exit: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { on: vi.fn(), relaunch: handlers.restart, exit: handlers.exit },
  BrowserWindow: {},
  dialog: {},
  Notification: {},
  safeStorage: {},
  ipcMain: {
    handle: (
      channel: string,
      listener: (
        event: unknown,
        patch: Partial<Settings>,
      ) => Promise<SettingsResult>,
    ) => {
      if (channel === "settings:set") handlers.settings = listener;
      if (channel === "app:relaunch")
        handlers.relaunch = () => listener(undefined, {});
    },
    on: vi.fn(),
  },
}));
vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function register(
  settings: SettingsService,
  loggingBarrier: () => Promise<void>,
  relaunchBarrier?: () => Promise<void>,
) {
  const unused = (): never => {
    throw new Error("Unexpected parser/zip access");
  };
  registerIpcHandlers(
    settings,
    new NetworkService(),
    unused,
    unused,
    undefined,
    undefined,
    loggingBarrier,
    relaunchBarrier,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("settings IPC concurrency", () => {
  it.each([{ elasticPassPlain: "replacement" }, { elasticPassClear: true }])(
    "does not overwrite concurrent patches when saving a password: %o",
    async (password) => {
      const settings = new SettingsService();
      settings.update({ follow: false, elasticPassEnc: "encrypted-old" });
      vi.spyOn(settings, "save").mockResolvedValue(true);
      vi.spyOn(settings, "encryptSecret").mockReturnValue("encrypted-new");
      const barrier = deferred();
      const onLoggingChange = vi.fn(() => barrier.promise);
      register(settings, onLoggingChange);
      const handle = handlers.settings!;
      const pending = handle(undefined, { logMaxBackups: 4, ...password });
      expect(onLoggingChange).toHaveBeenCalledOnce();
      expect((await handle(undefined, { follow: true })).ok).toBe(true);
      barrier.resolve();
      expect((await pending).ok).toBe(true);
      expect(settings.get().follow).toBe(true);
      expect(settings.get().elasticPassEnc).toBe(
        password.elasticPassClear ? "" : "encrypted-new",
      );
      expect(Object.hasOwn(settings.get(), "elasticPassPlain")).toBe(false);
      expect(onLoggingChange).toHaveBeenCalledOnce();
    },
  );

  it("does not replace a newer password after awaiting the logging barrier", async () => {
    const settings = new SettingsService();
    vi.spyOn(settings, "save").mockResolvedValue(true);
    vi.spyOn(settings, "encryptSecret").mockReturnValue("encrypted-new");
    const barrier = deferred();
    register(settings, () => barrier.promise);
    const pending = handlers.settings!(undefined, {
      logMaxBackups: 4,
      elasticPassPlain: "replacement",
    });
    await handlers.settings!(undefined, { elasticPassClear: true });
    barrier.resolve();
    await pending;
    expect(settings.get().elasticPassEnc).toBe("");
  });
});

it("drains accepted file writes before the relaunch exit bypasses will-quit", async () => {
  const barrier = deferred();
  register(
    new SettingsService(),
    async () => {},
    () => barrier.promise,
  );
  const pending = handlers.relaunch!();
  expect(handlers.restart).not.toHaveBeenCalled();
  expect(handlers.exit).not.toHaveBeenCalled();
  barrier.resolve();
  await pending;
  expect(handlers.restart).toHaveBeenCalledOnce();
  expect(handlers.exit).toHaveBeenCalledWith(0);
});
