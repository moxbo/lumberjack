import { build } from "esbuild";
import { test, expect } from "./electron-fixtures";
import type * as CoreControl from "./fixtures/preact-core";

declare global {
  interface Window {
    preactCoreTest: typeof CoreControl;
  }
}

test("core portals preserve positioning, context and keyboard interaction without compat", async ({
  window,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const bundle = await build({
    entryPoints: ["tests/e2e/fixtures/preact-core.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "preactCoreTest",
    footer: { js: "globalThis.window.preactCoreTest = preactCoreTest;" },
    platform: "browser",
    metafile: true,
  });
  expect(
    Object.keys(bundle.metafile.inputs).filter((file) =>
      file.includes("/preact/compat/"),
    ),
  ).toEqual([]);
  await window.evaluate(bundle.outputFiles[0]!.text);
  await window.evaluate(() => globalThis.window.preactCoreTest.mount());

  const trigger = window.locator("#core-portal-trigger");
  const tooltip = window.getByRole("dialog", { name: "Core tooltip" });
  const coordinates = await trigger.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.bottom + 4, left: rect.left + rect.width / 2 };
  });
  await trigger.focus();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("provided through portal");
  expect(
    await tooltip.evaluate(
      (element) => element.parentElement === document.body,
    ),
  ).toBe(true);
  const style = await tooltip.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      top: Number.parseFloat(computed.top),
      left: Number.parseFloat(computed.left),
    };
  });
  expect(style.top).toBeCloseTo(coordinates.top, 1);
  expect(style.left).toBeCloseTo(coordinates.left, 1);

  await trigger.press("Tab");
  const action = tooltip.getByRole("button", { name: "Portal action" });
  await expect(action).toBeFocused();
  await action.press("Enter");
  await expect(window.locator("#core-portal-clicks")).toHaveText("1");
  await window.locator("#searchText").focus();
  await expect(tooltip).toHaveCount(0);
  await trigger.focus();
  await expect(tooltip).toBeVisible();
  await trigger.press("Tab");
  await expect(action).toBeFocused();
  await action.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.hover();
  await expect(tooltip).toBeVisible();
  await window.evaluate(() => globalThis.window.preactCoreTest.unmount());
  await expect(tooltip).toHaveCount(0);
  await expect(window.locator("#preact-core-fixture")).toHaveCount(0);
});
