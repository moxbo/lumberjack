import { test, expect } from "./electron-fixtures";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

declare global {
  interface Window {
    searchTestControl: {
      arm(): void;
      release(): void;
      queuedFinals: number;
    };
  }
}

test("shows real partial matches, rejects superseded results and preserves the viewport", async ({
  electronApp,
  window,
  testUserData,
}) => {
  // Hold later real worker responses to make partial-result interactions deterministic.
  await window.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    let armed = false;
    let blockedGeneration: string | undefined;
    const pending: Array<() => void> = [];
    const control = {
      queuedFinals: 0,
      arm() {
        armed = true;
        blockedGeneration = undefined;
        control.queuedFinals = 0;
      },
      release() {
        armed = false;
        blockedGeneration = undefined;
        pending.splice(0).forEach((deliver) => deliver());
      },
    };
    globalThis.window.searchTestControl = control;
    globalThis.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.defineProperty(this, "onmessage", {
          value: null,
          writable: true,
        });
        this.addEventListener("message", (event) => {
          const data = event.data;
          const deliver = () => this.onmessage?.call(this, event);
          if (data.type === "result") {
            if (
              blockedGeneration !== undefined &&
              data.generation === blockedGeneration
            ) {
              pending.push(deliver);
              if (!data.partial) control.queuedFinals++;
              return;
            }
            if (armed && data.partial) {
              armed = false;
              blockedGeneration = data.generation;
            }
          }
          deliver();
        });
      }
    };
  });
  await window.reload();
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const entries = Array.from({ length: 6001 }, (_, index) => ({
    // The first scanned page sorts after later pages, exercising stable-ID mapping.
    timestamp: new Date(
      1_700_000_000_000 + (index < 2000 ? 100_000 + index : index),
    ).toISOString(),
    level: index % 2 === 0 ? "INFO" : "ERROR",
    logger: "e2e.progressive",
    message:
      index === 1000 || index === 5500 ? `needle-${index}` : `row-${index}`,
  }));
  const inputPath = path.join(testUserData, "search.ndjson");
  await writeFile(
    inputPath,
    entries.map((entry) => JSON.stringify(entry)).join("\n"),
  );
  await electronApp.evaluate(({ dialog, BrowserWindow }, filePath) => {
    BrowserWindow.getFocusedWindow = () =>
      BrowserWindow.getAllWindows()[0] ?? null;
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
    BrowserWindow.getAllWindows()[0]!.webContents.send("menu:cmd", {
      type: "open-files",
    });
  }, inputPath);
  await expect(window.locator("#countTotal")).toHaveText("6001");

  const search = window.locator("#searchText");
  const progress = window.locator(".filter-progress progress");
  const selectedMessage = window.locator(".row.sel .col.msg");
  const status = window.locator(".filter-progress > span").first();
  await window.evaluate(() => globalThis.window.searchTestControl.arm());
  await search.fill("needle");
  await search.press("Enter");
  await expect(progress).toHaveAttribute("value", "2000");
  await expect(selectedMessage).toHaveText("needle-1000");
  await expect(selectedMessage).toBeVisible();
  await expect(window.locator("#countFiltered")).toHaveText("6001");

  await window.locator('.row[data-vi="5002"]').click();
  const selection = await selectedMessage.textContent();
  const scrollTop = await window
    .locator(".list")
    .evaluate((element) => element.scrollTop);
  await expect
    .poll(() =>
      window.evaluate(() => globalThis.window.searchTestControl.queuedFinals),
    )
    .toBeGreaterThan(0);
  await window.evaluate(() => globalThis.window.searchTestControl.release());
  await expect(progress).toHaveCount(0);
  await expect(status).toContainText(/2 (matches|Treffer)/);
  await expect(selectedMessage).toHaveText(selection!);
  expect(
    await window.locator(".list").evaluate((element) => element.scrollTop),
  ).toBeCloseTo(scrollTop, 0);

  await window.evaluate(() => globalThis.window.searchTestControl.arm());
  await search.fill("row-");
  await search.press("Enter");
  await expect(progress).toHaveAttribute("value", "2000");
  await expect
    .poll(() =>
      window.evaluate(() => globalThis.window.searchTestControl.queuedFinals),
    )
    .toBeGreaterThan(0);
  await search.fill("not-present-anywhere");
  await search.press("Enter");
  await expect(progress).toHaveCount(0);
  await expect(status).toContainText(/0 (matches|Treffer)/);
  await window.evaluate(() => globalThis.window.searchTestControl.release());
  await expect(status).toContainText(/0 (matches|Treffer)/);

  await search.fill("");
  await search.press("Enter");
  await expect(window.locator(".filter-progress")).toHaveCount(0);
  await window.evaluate(() => globalThis.window.searchTestControl.arm());
  await window.locator("#filterLevel").selectOption("ERROR");
  await expect(window.locator("#countFiltered")).toHaveText("1000");
  await window.locator(".list").dispatchEvent("wheel", { deltaY: 1 });
  await window.locator(".list").evaluate((element) => {
    element.scrollTop = 200 * 36 + 7;
  });
  const anchoredRow = window.locator('.row[data-vi="210"] .col.msg');
  await expect(anchoredRow).toContainText("row-");
  await anchoredRow.click();
  const anchoredMessage = await anchoredRow.textContent();
  const before = await anchoredRow.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await expect
    .poll(() =>
      window.evaluate(() => globalThis.window.searchTestControl.queuedFinals),
    )
    .toBeGreaterThan(0);
  await window.evaluate(() => globalThis.window.searchTestControl.release());
  await expect(window.locator("#countFiltered")).toHaveText("3000");
  await expect(progress).toHaveCount(0);
  await expect(selectedMessage).toHaveText(anchoredMessage!);
  expect(
    await selectedMessage.evaluate(
      (element) => element.getBoundingClientRect().top,
    ),
  ).toBeCloseTo(before, 0);

  await window.evaluate(() => globalThis.window.searchTestControl.arm());
  await window.locator("#filterLevel").selectOption("INFO");
  await expect(progress).toHaveAttribute("value", "2000");
  await expect
    .poll(() =>
      window.evaluate(() => globalThis.window.searchTestControl.queuedFinals),
    )
    .toBeGreaterThan(0);
  await window
    .getByRole("button", { name: /^(Clear Logs|Logs leeren)$/ })
    .click();
  await window.getByRole("button", { name: "OK", exact: true }).click();
  await expect(window.locator("#countTotal")).toHaveText("0");
  await expect(window.locator("#countFiltered")).toHaveText("0");
  await writeFile(
    inputPath,
    JSON.stringify({ ...entries[0], message: "replacement" }),
  );
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send("menu:cmd", {
      type: "open-files",
    });
  });
  await expect(window.locator("#countTotal")).toHaveText("1");
  await expect(window.locator("#countFiltered")).toHaveText("1");
  await expect(window.locator(".row .col.msg")).toHaveText("replacement");
  await window.evaluate(() => globalThis.window.searchTestControl.release());
  await expect(window.locator("#countFiltered")).toHaveText("1");
  await expect(window.locator(".row .col.msg")).toHaveText("replacement");
});
