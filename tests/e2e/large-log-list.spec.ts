import { build } from "esbuild";
import { test, expect } from "./electron-fixtures";
import type * as ListControl from "./fixtures/large-log-list";

declare global {
  interface Window {
    largeLogListTest: typeof ListControl;
  }
}

test("reaches the final row beyond Chromium's scroll-height limit", async ({
  window,
}) => {
  const settleLayout = () =>
    window.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
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
  await settleLayout();
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
  await settleLayout();
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
