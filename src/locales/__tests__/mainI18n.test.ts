import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
  },
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getLocale, initI18n, setLocale, t } from "../mainI18n";

describe("main process i18n", () => {
  beforeEach(() => {
    initI18n("de");
  });

  it("switches native menu translations at runtime", () => {
    expect(t("main.menu.file")).toBe("Datei");
    expect(t("main.menu.hide", { app: "Lumberjack" })).toBe(
      "Lumberjack ausblenden",
    );

    setLocale("en");

    expect(getLocale()).toBe("en");
    expect(t("main.menu.file")).toBe("File");
    expect(t("main.menu.hide", { app: "Lumberjack" })).toBe("Hide Lumberjack");
  });

  it.each([
    "services",
    "hide",
    "hideOthers",
    "unhide",
    "pasteAndMatchStyle",
    "delete",
    "startSpeaking",
    "stopSpeaking",
  ])("provides the native role label %s in both locales", (key) => {
    const keyPath = `main.menu.${key}`;
    expect(t(keyPath, { app: "Lumberjack" })).not.toBe(keyPath);

    setLocale("en");
    expect(t(keyPath, { app: "Lumberjack" })).not.toBe(keyPath);
  });
});
