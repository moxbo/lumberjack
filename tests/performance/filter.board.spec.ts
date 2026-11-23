import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, openLogFiles, test } from "../e2e/electron-fixtures";
import {
  absent,
  makeFixture,
  needle,
  rows,
  type Metrics,
  type Sample,
} from "./scenario";

test.use({ appRoot: resolve(process.env.PERF_BOARD_APP_ROOT || ".") });

async function measure(
  page: Page,
  query: string,
  expected: number,
): Promise<Metrics> {
  const input = page.locator("#filterMessage");
  await input.fill(query);
  // Use the renderer clock at Enter, not Playwright transport or polling time.
  const probe = await page.evaluateHandle(
    ({ query, expected }) => {
      const list = document.querySelector<HTMLElement>(
        '.list[role="listbox"]',
      )!;
      const count = document.querySelector("#countFiltered")!;
      function inView(el: Element): boolean {
        const box = el.getBoundingClientRect();
        const viewport = list.getBoundingClientRect();
        const headerBottom = list
          .querySelector(".list-header")!
          .getBoundingClientRect().bottom;
        return (
          box.width > 0 &&
          box.height > 0 &&
          box.bottom > Math.max(0, viewport.top, headerBottom) &&
          box.top < Math.min(innerHeight, viewport.bottom) &&
          box.right > Math.max(0, viewport.left) &&
          box.left < Math.min(innerWidth, viewport.right)
        );
      }
      const isResultVisible = () =>
        expected === 0
          ? count.textContent === "0" &&
            [...list.querySelectorAll(".list-empty-title")].some(inView)
          : [...list.querySelectorAll(".row .col.msg")].some(
              (el) => el.textContent?.includes(query) && inView(el),
            );
      if (isResultVisible())
        throw new Error("Benchmark would time a stale visible result");
      if (!PerformanceObserver.supportedEntryTypes.includes("longtask"))
        throw new Error("Renderer Long Tasks API unavailable");

      const result = new Promise<Metrics>((resolve, reject) => {
        window.addEventListener(
          "keydown",
          (event) => {
            if (
              event.key !== "Enter" ||
              (event.target as HTMLElement).id !== "filterMessage"
            ) {
              reject(new Error("Expected Enter on the message filter"));
              return;
            }
            const start = performance.now();
            const tasks: PerformanceEntry[] = [];
            const observer = new PerformanceObserver((list) =>
              tasks.push(...list.getEntries()),
            );
            observer.observe({ type: "longtask" });
            let visibleMs: number | undefined;
            const timeout = setTimeout(() => {
              observer.disconnect();
              reject(
                new Error(
                  `Filter '${query}' did not settle: expected ${expected}, displayed ${count.textContent}, visible result: ${visibleMs !== undefined}`,
                ),
              );
            }, 90_000);
            function frame() {
              const now = performance.now();
              if (visibleMs === undefined && isResultVisible())
                visibleMs = now - start;
              if (
                visibleMs !== undefined &&
                count.textContent === String(expected) &&
                !document.querySelector(".filter-progress")
              ) {
                const visible = visibleMs;
                // Flush entries for work ending in this frame, but exclude time after completion.
                requestAnimationFrame(() => {
                  tasks.push(...observer.takeRecords());
                  observer.disconnect();
                  clearTimeout(timeout);
                  const longest = tasks.reduce(
                    (max, t) =>
                      Math.max(
                        max,
                        Math.min(now, t.startTime + t.duration) -
                          Math.max(start, t.startTime),
                      ),
                    0,
                  );
                  resolve({
                    visibleMs: visible,
                    completeMs: now - start,
                    longestTaskMs: longest,
                  });
                });
              } else {
                requestAnimationFrame(frame);
              }
            }
            requestAnimationFrame(frame);
          },
          { capture: true, once: true },
        );
      });
      return { result };
    },
    { query, expected },
  );
  try {
    await input.press("Enter");
    return await probe.evaluate((p) => p.result);
  } finally {
    await probe.dispose();
  }
}

test("filter latency in the visible Electron workspace", async ({
  electronApp,
  window: page,
  testUserData,
}, info) => {
  const { content, hits } = makeFixture();
  const file = join(testUserData, "board.ndjson");
  await writeFile(file, content);
  await expect(page.locator("#splash-screen")).toHaveCount(0);
  // Fix the workspace geometry so the empty-state title fits above the details pane.
  await page.setViewportSize({ width: 1280, height: 960 });
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.show();
    win.focus();
  });
  await page.bringToFront();
  const imported = await page.evaluateHandle(() => ({
    done: new Promise<string[]>((resolve) => {
      const off = window.api.onStreamComplete((result) => {
        off();
        resolve(result.errors);
      });
    }),
  }));
  await openLogFiles(electronApp, [file]);
  expect(await imported.evaluate((probe) => probe.done)).toEqual([]);
  await imported.dispose();
  await expect(page.locator("#countTotal")).toHaveText(String(rows));
  await expect(page.locator("#countFiltered")).toHaveText(String(rows));
  await expect(page.locator(".row .col.msg").first()).toContainText(
    "payment-accepted",
  );
  if (!(await page.locator("#filterMessage").isVisible()))
    await page.locator(".filter-toggle-btn").click();
  // document.hidden alone misses Electron's native background publication delay.
  const foreground = await page.evaluateHandle(() => {
    let hidden = false;
    const ready = new Promise<boolean>((resolve) => {
      window.api.onWindowVisibilityChange((visible) => {
        hidden ||= !visible;
        resolve(visible);
      });
    });
    return { ready, interrupted: () => hidden || document.hidden };
  });
  expect(
    await foreground.evaluate((p) => p.ready),
    "Window must be visible",
  ).toBe(true);
  const sample: Sample = {
    fixtureHash: createHash("sha256").update(content).digest("hex"),
    electron: await electronApp.evaluate(() => process.versions.electron!),
    phases: {
      first: await measure(page, needle, hits),
      noMatch: await measure(page, absent, 0),
      repeat: await measure(page, needle, hits),
    },
  };
  expect(
    await foreground.evaluate((p) => p.interrupted()),
    "Window hidden during measurement",
  ).toBe(false);
  await foreground.dispose();
  await writeFile(info.outputPath("sample.json"), JSON.stringify(sample));
});
