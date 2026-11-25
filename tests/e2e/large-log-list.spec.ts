import type { Page } from "@playwright/test";
import { build } from "esbuild";
import { test, expect } from "./electron-fixtures";
import type * as ListControl from "./fixtures/large-log-list";

declare global {
  interface Window {
    largeLogListTest: typeof ListControl;
  }
}

function settleLayout(page: Page) {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test.beforeEach(async ({ window }) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const bundle = await build({
    entryPoints: ["tests/e2e/fixtures/large-log-list.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "largeLogListTest",
    footer: { js: "globalThis.window.largeLogListTest = largeLogListTest;" },
    platform: "browser",
    define: { "import.meta": "{}" },
    alias: { react: "preact/compat", "react-dom": "preact/compat" },
  });
  await window.evaluate(bundle.outputFiles[0]!.text);
});

test("keeps scrolled rows on device pixels without losing fractional wheel input", async ({
  window,
  electronApp,
}) => {
  const browserWindow = await electronApp.browserWindow(window);
  const nativeScale =
    (await window.evaluate(() => devicePixelRatio)) /
    (await browserWindow.evaluate((win) => win.webContents.getZoomFactor()));
  const setScale = async (ratio: number) => {
    await browserWindow.evaluate(
      (win, zoom) => win.webContents.setZoomFactor(zoom),
      ratio / nativeScale,
    );
    await expect
      .poll(() => window.evaluate(() => devicePixelRatio))
      .toBeCloseTo(ratio, 3);
  };
  await setScale(2);
  await window.evaluate(() =>
    globalThis.window.largeLogListTest.mount(300_000),
  );
  const list = window.locator("#large-log-list-fixture .list");
  await list.evaluate((el) => (el.style.marginTop = "0.125px"));
  await settleLayout(window);
  const row = list.locator('.row[role="option"][data-vi="4"]');
  const deviceY = () =>
    row.evaluate((el) => el.getBoundingClientRect().top * devicePixelRatio);
  const initial = await deviceY();

  for (let step = 1; step <= 2; step++) {
    // At 2x, each event moves 0.4 device pixels; together they move one.
    await list.dispatchEvent("wheel", { deltaY: 0.2, cancelable: true });
    await settleLayout(window);
    expect(await deviceY()).toBeCloseTo(Math.round(initial - step * 0.4), 2);
  }

  await list.evaluate((el) => (el.scrollTop = 5));
  await settleLayout(window);
  const scrolled = await deviceY();
  expect(scrolled).toBeLessThan(initial - 10);
  expect(scrolled).toBeCloseTo(Math.round(scrolled), 2);

  // A display scale change should realign the resting row without another scroll.
  await setScale(1.25);
  await settleLayout(window);
  const rescaled = await deviceY();
  expect(rescaled).toBeCloseTo(Math.round(rescaled), 2);
});

test("reaches the final row beyond Chromium's scroll-height limit", async ({
  window,
}) => {
  await window.evaluate(() => globalThis.window.largeLogListTest.mount());
  const list = window.locator(".list").last();
  const lastRow = list.locator('[data-vi="1772244"] .msg');
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(lastRow).toHaveText("row-1772245");
  await expect(lastRow).toBeInViewport();
  expect(await list.evaluate((element) => element.scrollHeight)).toBeLessThan(
    8_000_100,
  );
  await window.evaluate(() =>
    globalThis.window.largeLogListTest.selectAndNavigate(1_500_000),
  );
  await expect(list.locator(".row.sel .msg")).toHaveText("row-1500001");
  await expect(list.locator(".row.sel")).toBeInViewport();

  await window.evaluate(() =>
    globalThis.window.largeLogListTest.setRows(100, 1_500_001, "filtered"),
  );
  await window.evaluate(() =>
    globalThis.window.largeLogListTest.restoreSelection(),
  );
  await expect(list.locator(".row.sel")).toHaveAttribute("data-vi", "0");
  await expect(list.locator(".row.sel")).toBeInViewport();
  await window.evaluate(() =>
    globalThis.window.largeLogListTest.setRows(1_772_245, 1, "all"),
  );
  await window.evaluate(() =>
    globalThis.window.largeLogListTest.restoreSelection(),
  );
  await settleLayout(window);
  await expect(list.locator(".row.sel")).toHaveAttribute("data-vi", "1500000");
  await expect(list.locator(".row.sel")).toBeInViewport();

  const before = await list
    .locator(".row.sel")
    .evaluate((element) => element.getBoundingClientRect().top);
  await window.evaluate(() =>
    globalThis.window.largeLogListTest.setRows(2_000_000),
  );
  await expect
    .poll(() =>
      list
        .locator(".row.sel")
        .evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeCloseTo(before, 0);
  await window.evaluate(() => globalThis.window.largeLogListTest.navigate(0));
  await expect(list.locator('[data-vi="0"] .msg')).toHaveText("row-1");
  await expect(list.locator('[data-vi="0"]')).toBeInViewport();
  await window.evaluate(() =>
    globalThis.window.largeLogListTest.navigate(1_999_999, "end"),
  );
  await expect(list.locator('[data-vi="1999999"] .msg')).toHaveText(
    "row-2000000",
  );
  await expect(list.locator('[data-vi="1999999"]')).toBeInViewport();
  await window.evaluate(() =>
    globalThis.window.largeLogListTest.selectAndNavigate(1_500_000),
  );
  await expect(list.locator(".row.sel")).toBeInViewport();
  const topBeforeWheel = await list
    .locator(".row.sel")
    .evaluate((element) => element.getBoundingClientRect().top);
  await list.dispatchEvent("wheel", {
    deltaY: 36,
    deltaMode: 0,
    cancelable: true,
  });
  await expect
    .poll(() =>
      list
        .locator(".row.sel")
        .evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeCloseTo(topBeforeWheel - 36, 0);
  await window.evaluate(() => globalThis.window.largeLogListTest.resize(500));
  await settleLayout(window);
  await expect
    .poll(() =>
      list
        .locator(".row.sel")
        .evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeCloseTo(topBeforeWheel - 36, 0);

  await window.evaluate(() =>
    globalThis.window.largeLogListTest.navigate(1_999_999, "end"),
  );
  await expect(list.locator('[data-vi="1999999"]')).toBeInViewport();
  await window.evaluate(() =>
    globalThis.window.largeLogListTest.setFollow(true),
  );
  await list.dispatchEvent("wheel", {
    deltaY: -120,
    deltaMode: 0,
    cancelable: true,
  });
  await expect
    .poll(() =>
      window.evaluate(() => globalThis.window.largeLogListTest.followEnabled),
    )
    .toBe(false);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() =>
      list.evaluate((element) => {
        const last = element.querySelector('[data-vi="1999999"]');
        return last
          ? last.getBoundingClientRect().bottom -
              element.getBoundingClientRect().bottom
          : Infinity;
      }),
    )
    .toBeCloseTo(0, 0);
  expect(await list.locator(".row").count()).toBeLessThan(100);
  expect(
    await window.evaluate(
      () => globalThis.window.largeLogListTest.largestPayloadRequest,
    ),
  ).toBeLessThan(100);

  expect(
    await window.evaluate(() =>
      globalThis.window.largeLogListTest.replaceHandle(),
    ),
  ).toEqual({ previousCleared: true, attached: true });
  await window.evaluate(() => globalThis.window.largeLogListTest.navigate(0));
  await expect(list.locator('[data-vi="0"]')).toBeInViewport();

  expect(
    await window.evaluate(() => globalThis.window.largeLogListTest.unmount()),
  ).toEqual({ handleCleared: true, listCleared: true });
  await expect(window.locator("#large-log-list-fixture")).toHaveCount(0);
});
