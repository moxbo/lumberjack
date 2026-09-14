import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "../useSettings";
import {
  appRelaunch,
  autoUpdaterSetAllowPrerelease,
  getSettings,
  patchSettings,
  windowPermsGet,
} from "../../utils/typedApi";
import { nativeConfirm } from "../../utils/nativeDialog";
import type { Settings } from "../../types/ipc";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => unknown)[],
}));
vi.mock("preact/hooks", () => ({
  useRef: <T>(initial: T) => {
    const index = hooks.cursor++;
    return (hooks.slots[index] ??= { current: initial });
  },
  useState: <T>(initial: T | (() => T)) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] =
        typeof initial === "function" ? (initial as () => T)() : initial;
    }
    return [
      hooks.slots[index],
      (value: T | ((previous: T) => T)) => {
        hooks.slots[index] =
          typeof value === "function"
            ? (value as (previous: T) => T)(hooks.slots[index] as T)
            : value;
      },
    ];
  },
  useCallback: <T>(callback: T) => {
    const index = hooks.cursor++;
    return (hooks.slots[index] ??= callback);
  },
  useEffect: (effect: () => unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) {
      hooks.slots[index] = true;
      hooks.effects.push(effect);
    }
  },
}));
vi.mock("../../utils/typedApi", () => ({
  getSettings: vi.fn(),
  patchSettings: vi.fn(),
  windowPermsGet: vi.fn(),
  appRelaunch: vi.fn(),
  autoUpdaterSetAllowPrerelease: vi.fn(),
}));
vi.mock("../../utils/nativeDialog", () => ({ nativeConfirm: vi.fn() }));
vi.mock("../../utils/logger", () => ({
  default: { warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../utils/rendererPerf", () => ({
  rendererPerf: { mark: vi.fn() },
}));

const attributes = new Map<string, string>();
const setProperty = vi.fn();
const splash = { classList: { add: vi.fn() }, remove: vi.fn() };
const showAlert = vi.fn();
const onLoaded = vi.fn();
const t = (key: string) => key;
function render(translate = t) {
  hooks.cursor = 0;
  return useSettings({ t: translate, showAlert, onLoaded });
}
async function mount() {
  const hook = render();
  hooks.effects.splice(0).forEach((effect) => effect());
  await vi.advanceTimersByTimeAsync(0);
  return hook;
}

beforeEach(() => {
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  attributes.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      removeAttribute: (key: string) => attributes.delete(key),
      style: { setProperty },
    },
    getElementById: () => splash,
  });
  vi.mocked(getSettings).mockResolvedValue({} as Settings);
  vi.mocked(windowPermsGet).mockResolvedValue({
    ok: true,
    canTcpControl: false,
  });
  vi.mocked(patchSettings).mockResolvedValue({ ok: true });
  vi.mocked(autoUpdaterSetAllowPrerelease).mockResolvedValue(true);
  vi.mocked(nativeConfirm).mockResolvedValue(false);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useSettings integration", () => {
  it("persists the detail layout independently of theme and restores its width", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      themeMode: "dark",
      detailLayout: "right",
      detailWidth: 480,
    } as Settings);
    await mount();
    expect(render().detailLayout).toBe("right");
    expect(setProperty).toHaveBeenCalledWith("--detail-width", "480px");
    await render().setDetailLayout("bottom");
    expect(patchSettings).toHaveBeenCalledWith({ detailLayout: "bottom" });
    expect(render().detailLayout).toBe("bottom");
    expect(render().themeMode).toBe("dark");
    expect(attributes.get("data-theme")).toBe("dark");
  });

  it("reports failed layout persistence without changing the theme", async () => {
    await mount();
    vi.mocked(patchSettings).mockResolvedValue({
      ok: false,
      error: "disk full",
    });
    await render().setDetailLayout("right");
    expect(showAlert).toHaveBeenCalledWith("errors.saveFailed");
    expect(render().themeMode).toBe("system");
  });

  it("hydrates settings, feature callbacks, layout, permissions and splash exactly once", async () => {
    const settings = {
      isMaximized: false,
      tcpPort: 6123,
      httpUrl: "https://logs.test",
      httpPollInterval: 7,
      httpTailEmitInitial: true,
      httpTailAllowInsecureSSL: true,
      themeMode: "dark",
      follow: true,
      elasticMaxParallel: 4,
      elasticPassEnc: "encrypted",
      allowPrerelease: true,
      histAppName: ["app"],
      histEnvironment: ["env"],
      histIndex: ["logs-*"],
      lastEnvironmentCase: "lower",
      marksMap: { signature: "#f00" },
      customMarkColors: ["#123456"],
      onlyMarked: true,
      detailHeight: 150.5,
      colTs: 180,
      colLvl: 60,
      colLogger: 200,
    } as Settings;
    vi.mocked(getSettings).mockResolvedValue(settings);
    await mount();
    expect(render()).toMatchObject({
      settingsLoaded: true,
      tcpPort: 6123,
      httpInterval: 7,
      httpTailEmitInitial: true,
      httpTailAllowInsecureSSL: true,
      themeMode: "dark",
      follow: true,
      elasticHasPass: true,
      elasticMaxParallel: 4,
      canTcpControlWindow: false,
    });
    expect(onLoaded).toHaveBeenCalledExactlyOnceWith(settings);
    expect(setProperty).toHaveBeenCalledWith("--detail-height", "151px");
    expect(setProperty).toHaveBeenCalledWith("--col-logger", "200px");
    expect(attributes.get("data-theme")).toBe("dark");
    expect(splash.classList.add).toHaveBeenCalledWith("hidden");
    await vi.advanceTimersByTimeAsync(300);
    expect(splash.remove).toHaveBeenCalledOnce();
  });

  it("finishes startup and reads permissions even when loading fails", async () => {
    vi.mocked(getSettings).mockRejectedValue(new Error("unavailable"));
    await mount();
    expect(render().settingsLoaded).toBe(true);
    expect(render().canTcpControlWindow).toBe(false);
    expect(splash.classList.add).toHaveBeenCalledWith("hidden");
  });

  it("keeps captured menu callbacks fresh and restores committed theme on cancel", async () => {
    const initial = await mount();
    initial.setHttpUrl("https://current.test");
    initial.setHttpInterval(17);
    initial.setThemeMode("dark");
    render();
    vi.mocked(getSettings).mockRejectedValue(new Error("offline"));
    await initial.openSettingsModal("features");
    const opened = render();
    expect(opened.form).toMatchObject({
      httpUrl: "https://current.test",
      httpInterval: 17,
      themeMode: "dark",
    });
    expect(opened.settingsTab).toBe("features");
    opened.applyThemeMode("light");
    initial.closeSettingsModal();
    expect(attributes.get("data-theme")).toBe("dark");
    expect(render().showSettings).toBe(false);
  });

  it("saves the latest form, updates elastic parallelism/password, and requests restart", async () => {
    const captured = await mount();
    await captured.openSettingsModal();
    let hook = render();
    hook.setForm({
      ...hook.form,
      tcpPort: 6124,
      elasticMaxParallel: 6,
      elasticPassNew: "new-password",
      heapSizeMB: 8192,
      allowPrerelease: true,
    });
    render((key) => `translated:${key}`);
    vi.mocked(nativeConfirm).mockResolvedValue(true);
    await captured.saveSettingsModal();
    hook = render();
    expect(hook).toMatchObject({
      tcpPort: 6124,
      elasticMaxParallel: 6,
      elasticHasPass: true,
      showSettings: false,
    });
    expect(autoUpdaterSetAllowPrerelease).toHaveBeenCalledWith(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(nativeConfirm).toHaveBeenCalledWith(
      "translated:settings.performance.restartRequired",
    );
    expect(appRelaunch).toHaveBeenCalledOnce();
  });

  it("keeps the modal and committed settings unchanged on failed saves", async () => {
    const captured = await mount();
    await captured.openSettingsModal();
    let hook = render();
    hook.setForm({ ...hook.form, tcpPort: 1234 });
    render();
    vi.mocked(patchSettings).mockResolvedValue({
      ok: false,
      error: "disk full",
    });
    await captured.saveSettingsModal();
    hook = render();
    expect(hook).toMatchObject({ tcpPort: 5000, showSettings: true });
    expect(showAlert).toHaveBeenCalledWith("errors.saveFailed");
    expect(autoUpdaterSetAllowPrerelease).not.toHaveBeenCalled();
  });
});
