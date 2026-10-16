import type { Locator } from "@playwright/test";
import { test, expect } from "./electron-fixtures";

async function expectReadableChip(chip: Locator): Promise<void> {
  const contrasts = await chip.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
    const channels = (color: string) => {
      const values = color.match(/[\d.]+/g)?.map(Number);
      if (!values || values.length < 3) {
        throw new Error(`Expected an RGB color, received ${color}`);
      }
      return values;
    };
    const composite = (color: number[], background: number[], opacity = 1) => {
      const alpha = (color[3] ?? 1) * opacity;
      return background.map((channel, index) => {
        const foreground = color[index];
        if (foreground === undefined) {
          throw new Error(`Missing color channel at index ${index}`);
        }
        return foreground * alpha + channel * (1 - alpha);
      });
    };
    const luminance = (color: number[]) =>
      color.reduce((total, channel, index) => {
        const value = channel / 255;
        const linear =
          value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        const weight = [0.2126, 0.7152, 0.0722][index];
        if (weight === undefined) {
          throw new Error(`Unexpected color channel at index ${index}`);
        }
        return total + linear * weight;
      }, 0);
    const chipStyle = getComputedStyle(element);
    if (chipStyle.backgroundImage !== "none") {
      throw new Error("Expected a solid filter chip background");
    }
    const chipBackground = channels(chipStyle.backgroundColor).slice(0, 3);
    return Array.from(
      element.querySelectorAll(".chip-label, .chip-value, .chip-remove"),
      (child) => {
        const style = getComputedStyle(child);
        const background = composite(
          channels(style.backgroundColor),
          chipBackground,
        );
        const foreground = composite(
          channels(style.color),
          background,
          Number(style.opacity),
        );
        const light = luminance(foreground);
        const dark = luminance(background);
        return {
          part: child.className,
          ratio:
            (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
        };
      },
    );
  });
  expect(contrasts).toHaveLength(3);
  for (const { part, ratio } of contrasts) {
    expect(ratio, `${part} text contrast`).toBeGreaterThanOrEqual(4.5);
  }
}

for (const colorScheme of ["light", "dark"] as const) {
  for (const themeMode of [colorScheme, "system"] as const) {
    test(`keeps filter chips readable with ${themeMode} theme on a ${colorScheme} system`, async ({
      window,
    }) => {
      await expect(window.locator("#splash-screen")).toHaveCount(0);
      await window.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await window.evaluate(
        (themeMode) => globalThis.window.api.settingsSet({ themeMode }),
        themeMode,
      );
      await window.reload();
      await expect(window.locator("#splash-screen")).toHaveCount(0);
      await window.setViewportSize({ width: 1440, height: 960 });
      if (!(await window.locator("#filterLogger").isVisible())) {
        await window.locator(".filter-toggle-btn").click();
      }
      await window.locator("#filterLogger").fill("orders.PaymentGateway");
      await window.locator("#filterLogger").press("Enter");
      const loggerChip = window
        .locator(".workspace-filterbar .filter-chip")
        .filter({ hasText: "orders.PaymentGateway" });
      await expect(loggerChip).toBeVisible();
      await expectReadableChip(loggerChip);
      const remove = loggerChip.locator(".chip-remove");
      await remove.hover();
      await expectReadableChip(loggerChip);
      await remove.focus();
      await window.mouse.move(0, 0);
      await expectReadableChip(loggerChip);

      for (const level of [
        "TRACE",
        "DEBUG",
        "INFO",
        "WARN",
        "ERROR",
        "FATAL",
      ]) {
        await window.locator("#filterLevel").selectOption(level);
        const chip = window.locator(
          `.filter-chip.level-${level.toLowerCase()}`,
        );
        await expect(chip).toBeVisible();
        await expectReadableChip(chip);
      }
      await window.locator(".filter-chip.level-fatal .chip-remove").click();
      await expect(window.locator("#filterLevel")).toHaveValue("");
      await remove.click();
      await expect(window.locator("#filterLogger")).toHaveValue("");
      await expect(
        window.locator(".workspace-filterbar .filter-chip"),
      ).toHaveCount(0);
    });
  }
}
