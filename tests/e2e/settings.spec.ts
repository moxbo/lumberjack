import { test, expect } from "./electron-fixtures";

test.beforeEach(async ({ window }) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
});

test("settings group existing controls without changing save and cancel behavior", async ({
  electronApp,
  window,
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:cmd", {
      type: "open-settings",
    });
  });
  const dialog = window.getByRole("dialog", {
    name: /^(Settings|Einstellungen)$/,
  });
  await expect(dialog.getByRole("tab")).toHaveCount(5);
  await expect(dialog.locator("#settings-tab-general")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.locator("#language")).toBeVisible();
  await expect(dialog.locator("#allowPrerelease")).toBeAttached();
  await expect(dialog.locator("#heapSizeMB")).toHaveCount(0);

  await dialog.locator("#settings-tab-appearance").click();
  await expect(dialog.locator("#theme")).toBeVisible();
  await expect(dialog.locator("#language")).toHaveCount(0);
  await dialog.locator("#theme").selectOption("light");
  await expect(window.locator("html")).toHaveAttribute("data-theme", "light");

  await dialog.locator("#settings-tab-connections").click();
  await expect(dialog.locator("#tcp-port")).toBeVisible();
  const originalPort = await dialog.locator("#tcp-port").inputValue();
  await dialog.locator("#tcp-port").fill("54321");
  await dialog.getByRole("button", { name: "HTTP", exact: true }).click();
  await expect(dialog.locator("#http-url")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Elasticsearch", exact: true })
    .click();
  await expect(dialog.locator("#es-url")).toBeVisible();
  await dialog.locator("#settings-tab-logging").click();
  await expect(dialog.locator("#log-file")).toBeVisible();
  await dialog.locator("#settings-tab-advanced").click();
  await expect(dialog.locator("#heapSizeMB")).toBeVisible();
  await expect(dialog.locator(".feature-flags-list")).toBeVisible();
  await expect(
    dialog.locator(".feature-flags-list input").first(),
  ).toHaveAttribute("aria-label", /.+/);
  await dialog.getByRole("button", { name: /^(Cancel|Abbrechen)$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(window.locator("html")).not.toHaveAttribute(
    "data-theme",
    "light",
  );

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:cmd", {
      type: "tcp-configure",
    });
  });
  await expect(dialog.locator("#tcp-port")).toHaveValue(originalPort);
  await expect(dialog.locator("#settings-tab-connections")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dialog.locator("#tcp-port").fill("54321");
  await dialog.getByRole("button", { name: /^(Save|Speichern)$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await window.evaluate(() => globalThis.window.api.settingsGet()))
          .settings?.tcpPort,
    )
    .toBe(54321);
});

test("settings support category keys, focus containment, escape and focus restoration", async ({
  electronApp,
  window,
}) => {
  const previousFocus = window.locator("#searchText");
  await previousFocus.focus();
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:cmd", {
      type: "open-settings",
    });
  });
  const dialog = window.getByRole("dialog", {
    name: /^(Settings|Einstellungen)$/,
  });
  const general = dialog.locator("#settings-tab-general");
  await expect(general).toBeFocused();
  await general.press("ArrowDown");
  await expect(dialog.locator("#settings-tab-appearance")).toBeFocused();
  await expect(dialog.locator("#theme")).toBeVisible();
  await dialog.locator("#settings-tab-appearance").press("End");
  await expect(dialog.locator("#settings-tab-advanced")).toBeFocused();
  await expect(dialog.locator("#heapSizeMB")).toBeVisible();
  await dialog.locator("#settings-tab-advanced").press("Home");
  await expect(general).toBeFocused();
  const save = dialog.getByRole("button", { name: /^(Save|Speichern)$/ });
  const close = dialog.getByRole("button", { name: /^(Close|Schließen)$/ });
  await save.focus();
  await save.press("Tab");
  await expect(close).toBeFocused();
  await close.press("Shift+Tab");
  await expect(save).toBeFocused();
  await save.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(previousFocus).toBeFocused();
});

test("settings respect appearance and accessibility preferences at compact sizes", async ({
  electronApp,
  window,
}) => {
  await window.setViewportSize({ width: 600, height: 520 });
  await window.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:cmd", {
      type: "open-settings",
    });
  });
  const dialog = window.getByRole("dialog", {
    name: /^(Settings|Einstellungen)$/,
  });
  await expect(dialog.getByRole("tablist")).toHaveAttribute(
    "aria-orientation",
    "horizontal",
  );
  await dialog.locator("#settings-tab-appearance").click();
  for (const theme of ["light", "dark", "system"]) {
    await dialog.locator("#theme").selectOption(theme);
    if (theme === "system") {
      await expect(window.locator("html")).not.toHaveAttribute("data-theme");
    } else {
      await expect(window.locator("html")).toHaveAttribute("data-theme", theme);
    }
    const styles = await dialog.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const active = element.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]',
      );
      if (!active) throw new Error("Missing active settings category");
      const activeStyle = getComputedStyle(active);
      return {
        fits:
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= innerHeight,
        solidSelection: activeStyle.backgroundImage === "none",
        selectionColor: activeStyle.color,
        selectionBackground: activeStyle.backgroundColor,
        border: style.getPropertyValue("--color-border").trim(),
        text: style.getPropertyValue("--color-text-secondary").trim(),
        duration: activeStyle.transitionDuration,
      };
    });
    expect(styles.fits).toBe(true);
    expect(styles.solidSelection).toBe(true);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3);
      if (!channels || channels.length !== 3) {
        throw new Error(`Expected an RGB color, received ${color}`);
      }
      return channels.reduce((total, channel, index) => {
        const value = Number(channel) / 255;
        const linear =
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        const weight = index === 0 ? 0.2126 : index === 1 ? 0.7152 : 0.0722;
        return total + linear * weight;
      }, 0);
    };
    const foreground = luminance(styles.selectionColor);
    const background = luminance(styles.selectionBackground);
    expect(
      (Math.max(foreground, background) + 0.05) /
        (Math.min(foreground, background) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
    expect(styles.border).toBe(styles.text);
    expect(styles.duration).toBe("0s");
  }
  await expect(
    dialog.getByRole("button", { name: /^(Save|Speichern)$/ }),
  ).toBeVisible();
});
