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

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
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
      vi.spyOn(settings, "encryptSecret").mockResolvedValue("encrypted-new");
      const barrier = deferred();
      const loggingStarted = deferred();
      const onLoggingChange = vi.fn(() => {
        loggingStarted.resolve();
        return barrier.promise;
      });
      register(settings, onLoggingChange);
      const handle = handlers.settings!;
      const pending = handle(undefined, { logMaxBackups: 4, ...password });
      await loggingStarted.promise;
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
    vi.spyOn(settings, "encryptSecret").mockResolvedValue("encrypted-new");
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

  it("applies a clear and overlapping ordinary fields after pending encryption", async () => {
    const settings = new SettingsService();
    vi.spyOn(settings, "save").mockResolvedValue(true);
    const encryption = deferred<string>();
    vi.spyOn(settings, "encryptSecret").mockReturnValueOnce(encryption.promise);
    register(settings, async () => {});
    const change = handlers.settings!(undefined, {
      elasticPassPlain: "fixture",
      follow: false,
      tcpPort: 5555,
    });
    const clear = handlers.settings!(undefined, {
      elasticPassClear: true,
      follow: true,
    });
    encryption.resolve("encrypted-fixture");
    expect((await change).ok).toBe(true);
    expect((await clear).ok).toBe(true);
    expect(settings.get()).toMatchObject({
      elasticPassEnc: "",
      follow: true,
      tcpPort: 5555,
    });
    expect(settings.get()).not.toHaveProperty("elasticPassPlain");
  });

  it("keeps the old password after encryption fails and accepts the next patch", async () => {
    const settings = new SettingsService();
    settings.update({ elasticPassEnc: "encrypted-old" });
    vi.spyOn(settings, "save").mockResolvedValue(true);
    vi.spyOn(settings, "encryptSecret").mockRejectedValueOnce(
      new Error("locked"),
    );
    register(settings, async () => {});
    expect(
      (await handlers.settings!(undefined, { elasticPassPlain: "fixture" })).ok,
    ).toBe(false);
    expect(settings.get().elasticPassEnc).toBe("encrypted-old");
    expect((await handlers.settings!(undefined, { follow: true })).ok).toBe(
      true,
    );
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
