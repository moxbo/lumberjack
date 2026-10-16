import { test, expect } from "./electron-fixtures";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

declare global {
  interface Window {
    searchReuseControl: {
      hold(): void;
      release(): void;
      pending: number;
      counts: string[];
    };
  }
}

test("keeps a completed filtered view while replacing navigation searches", async ({
  electronApp,
  window,
  testUserData,
}) => {
  await window.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    let holding = false;
    const pending: Array<() => void> = [];
    const control = {
      counts: [] as string[],
      get pending() {
        return pending.length;
      },
      hold() {
        holding = true;
        control.counts = [];
      },
      release() {
        holding = false;
        pending.splice(0).forEach((deliver) => deliver());
      },
    };
    globalThis.window.searchReuseControl = control;
    globalThis.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(this, "onmessage", {
          value: null,
          writable: true,
        });
        this.addEventListener("message", (event) => {
          const deliver = () => this.onmessage?.call(this, event);
          if (holding && event.data.type === "result") pending.push(deliver);
          else deliver();
        });
      }
    };
    document.addEventListener("DOMContentLoaded", () => {
      new MutationObserver(() => {
        const text = document.getElementById("countFiltered")?.textContent;
        if (text != null && control.counts.at(-1) !== text)
          control.counts.push(text);
      }).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
  });
  await window.reload();
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const input = path.join(testUserData, "search-reuse.ndjson");
  await writeFile(
    input,
    Array.from({ length: 6001 }, (_, index) =>
      JSON.stringify({
        timestamp: new Date(1_700_000_000_000 + index).toISOString(),
        level: index % 2 ? "ERROR" : "INFO",
        logger: "reuse.Search",
        message:
          index === 1001 || index === 5001
            ? "needleAlpha"
            : index === 2001 || index === 5801
              ? "needleBeta"
              : `row-${index}`,
      }),
    ).join("\n"),
  );
  await electronApp.evaluate(({ BrowserWindow, dialog }, filePath) => {
    BrowserWindow.getFocusedWindow = () =>
      BrowserWindow.getAllWindows()[0] ?? null;
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, input);
  await window.locator("#btnOpenLogs").click();
  await expect(window.locator("#countTotal")).toHaveText("6001");
  await window.locator(".filter-toggle-btn").click();
  await window.locator("#filterLevel").selectOption("ERROR");
  await expect(window.locator("#countFiltered")).toHaveText("3000");
  await expect(window.locator(".filter-progress")).toHaveCount(0);

  for (const query of ["needleAlpha", "needleBeta", ""]) {
    await window.locator(".list").evaluate((list) => {
      list.scrollTop = 18_000;
    });
    await window.locator('.row[data-vi="501"]').click();
    const selection = await window.locator(".row.sel .col.msg").textContent();
    const scrollTop = await window
      .locator(".list")
      .evaluate((list) => list.scrollTop);
    await window.evaluate(() => globalThis.window.searchReuseControl.hold());
    await window.locator("#searchText").fill(query);
    await window.locator("#searchText").press("Enter");
    // The first navigation scan must not hide or progressively rebuild the base list.
    await expect(window.locator("#countFiltered")).toHaveText("3000");
    if (query) {
      await expect
        .poll(() =>
          window.evaluate(() => globalThis.window.searchReuseControl.pending),
        )
        .toBeGreaterThan(0);
      await expect(window.locator(".row.sel .col.msg")).toHaveText(selection!);
      expect(
        await window.locator(".list").evaluate((list) => list.scrollTop),
      ).toBe(scrollTop);
      await window.locator('.row[data-vi="502"]').click();
    }
    const manualSelection = await window
      .locator(".row.sel .col.msg")
      .textContent();
    await window.evaluate(() => globalThis.window.searchReuseControl.release());
    await expect(window.locator(".filter-progress")).toHaveCount(0);
    await expect(window.locator("#countFiltered")).toHaveText("3000");
    await expect(window.locator(".row.sel .col.msg")).toHaveText(
      manualSelection!,
    );
    if (query)
      await expect(window.locator("#btnPrevMatch + span")).toHaveText(/\/2$/);
    else await expect(window.locator("#btnPrevMatch + span")).toHaveText("");
    expect(
      await window.evaluate(() =>
        globalThis.window.searchReuseControl.counts.every(
          (count) => count === "3000",
        ),
      ),
    ).toBe(true);
  }

  await window.locator("#filterLevel").selectOption("INFO");
  await expect(window.locator("#countFiltered")).toHaveText("3001");
  await window.locator("#searchText").fill("needleBeta");
  await window.locator("#searchText").press("Enter");
  await expect(window.locator(".filter-progress")).toHaveCount(0);
  await expect(window.locator("#btnPrevMatch + span")).toHaveText("");
  await expect(window.locator("#countFiltered")).toHaveText("3001");
});
