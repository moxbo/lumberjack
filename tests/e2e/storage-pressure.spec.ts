import { test, expect } from "./electron-fixtures";
import { readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

declare global {
  interface Window {
    failLogWrites: boolean;
  }
}

test("shows terminal HTTP poll failures delivered through preload", async ({
  electronApp,
  window,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send("http:pollError", {
      id: 1,
      url: "http://example.test/log",
      error: "File logging failed: ENOSPC",
    });
  });
  await expect(window.locator(".alert-message")).toContainText(
    "File logging failed: ENOSPC",
  );
});

test("pauses ingestion on quota failure, preserves exportable data and recovers after clear", async ({
  electronApp,
  window,
  testUserData,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const inputPath = path.join(testUserData, "pressure.ndjson");
  const outputPath = path.join(testUserData, "preserved.ndjson");
  const originalEntries = Array.from({ length: 600 }, (_, index) => ({
    timestamp: new Date(1_700_000_000_000 + index).toISOString(),
    level: "INFO",
    logger: "e2e.storage-pressure",
    message: `preserved-${index}`,
  }));
  await writeFile(
    inputPath,
    originalEntries.map((entry) => JSON.stringify(entry)).join("\n"),
  );
  await electronApp.evaluate(
    ({ BrowserWindow, dialog }, paths) => {
      BrowserWindow.getFocusedWindow = () =>
        BrowserWindow.getAllWindows()[0] ?? null;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [paths.inputPath],
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: paths.outputPath,
      });
    },
    { inputPath, outputPath },
  );
  const command = (type: string) =>
    electronApp.evaluate(({ BrowserWindow }, type) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send("menu:cmd", { type });
    }, type);
  await command("open-files");
  await expect(window.locator("#countTotal")).toHaveText("600");

  await window.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore the original receiver with .call below.
    const put = IDBObjectStore.prototype.put;
    globalThis.window.failLogWrites = true;
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ): IDBRequest<IDBValidKey> {
      if (
        globalThis.window.failLogWrites &&
        (this.name === "payloads" || this.name === "projections")
      ) {
        throw new DOMException(
          "Injected log storage quota failure",
          "QuotaExceededError",
        );
      }
      return key === undefined
        ? put.call(this, value)
        : put.call(this, value, key);
    };
  });
  const replacement = {
    timestamp: "2026-01-01T00:00:00.000Z",
    level: "ERROR",
    logger: "e2e.storage-pressure",
    message: "after-recovery",
  };
  await writeFile(inputPath, JSON.stringify(replacement));
  await command("open-files");
  await expect(window.locator(".alert-message")).toContainText(
    /quota|storage|speicher/i,
  );
  await expect(window.locator("#countTotal")).toHaveText("600");
  await window
    .locator(".modal-alert")
    .getByRole("button", { name: "OK", exact: true })
    .click();

  // Removing the injected fault must not silently resume with IDs reserved by
  // the failed write. The explicit clear starts a new dense-ID generation.
  await window.evaluate(() => {
    globalThis.window.failLogWrites = false;
  });
  await command("open-files");
  await expect(window.locator(".alert-message")).toContainText(
    /quota|storage|speicher|paused/i,
  );
  await expect(window.locator("#countTotal")).toHaveText("600");
  await window
    .locator(".modal-alert")
    .getByRole("button", { name: "OK", exact: true })
    .click();
  await command("export-view");
  await expect
    .poll(async () =>
      (await readdir(testUserData)).includes("preserved.ndjson"),
    )
    .toBe(true);
  const exported = (await readFile(outputPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { message: string });
  expect(exported.map((entry) => entry.message)).toEqual(
    originalEntries.map((entry) => entry.message),
  );

  await window
    .getByRole("button", { name: /^(Clear Logs|Logs leeren)$/ })
    .click();
  await window.getByRole("button", { name: "OK", exact: true }).click();
  await expect(window.locator("#countTotal")).toHaveText("0");
  await command("open-files");
  await expect(window.locator("#countTotal")).toHaveText("1");
  if (!(await window.locator("#filterLevel").isVisible())) {
    await window.locator(".filter-toggle-btn").click();
  }
  await window.locator("#filterLevel").selectOption("ERROR");
  await expect(window.locator("#countFiltered")).toHaveText("1");
  await expect(window.locator(".row .col.msg")).toHaveText("after-recovery");
});

test("does not silently switch to unlimited RAM when IndexedDB is unavailable", async ({
  electronApp,
  window,
  testUserData,
}) => {
  await window.addInitScript(() => {
    Object.defineProperty(globalThis, "indexedDB", { value: undefined });
  });
  await window.reload();
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const inputPath = path.join(testUserData, "unavailable.ndjson");
  await writeFile(
    inputPath,
    JSON.stringify({
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "INFO",
      message: "must-not-enter-unlimited-memory-fallback",
    }),
  );
  await electronApp.evaluate(({ BrowserWindow, dialog }, filePath) => {
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
  await expect(window.locator(".alert-message")).toContainText(
    /IndexedDB|storage|speicher/i,
  );
  await expect(window.locator("#countTotal")).toHaveText("0");
  await expect(window.locator(".row")).toHaveCount(0);
});
