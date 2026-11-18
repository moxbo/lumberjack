import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "./electron-fixtures";

test("seals the partial search page before completing an empty final stream chunk", async ({
  electronApp,
  window: page,
  testUserData,
}) => {
  // The first file crosses the streaming threshold and leaves half an index page.
  // The empty second file makes the final chunk empty regardless of IPC byte limits.
  const file = path.join(testUserData, "stream.ndjson");
  const empty = path.join(testUserData, "empty.ndjson");
  await writeFile(empty, "");
  await writeFile(
    file,
    Array.from({ length: 3000 }, (_, i) =>
      JSON.stringify({
        timestamp: i + 1,
        message: `${"x".repeat(400)} ${i === 2999 ? "last needle" : i}`,
      }),
    ).join("\n"),
  );
  await expect(page.locator("#splash-screen")).toHaveCount(0);
  const probe = await page.evaluateHandle(() => {
    let tailWrites = 0;
    let rowsInTail = 0;
    let emptyEof = false;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Observe real commits, forwarding the original receiver.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...key) {
      if (this.name === "message-search" && value.id === 2001) {
        const rows = value.ids?.length ?? 0;
        this.transaction.addEventListener("complete", () => {
          tailWrites++;
          rowsInTail = rows;
        });
      }
      return put.call(this, value, ...key);
    };
    const offChunk = window.api.onStreamChunk((chunk) => {
      if (chunk.done && chunk.fileIndex === chunk.totalFiles - 1) {
        emptyEof = chunk.entries.length === 0;
      }
    });
    return {
      completion: new Promise<{
        emptyEof: boolean;
        rowsInTail: number;
        tailWrites: number;
        errors: string[];
      }>((resolve) => {
        const offComplete = window.api.onStreamComplete((result) => {
          IDBObjectStore.prototype.put = put;
          offChunk();
          offComplete();
          resolve({ emptyEof, rowsInTail, tailWrites, errors: result.errors });
        });
      }),
    };
  });
  await electronApp.evaluate(
    ({ dialog, BrowserWindow }, filePaths) => {
      BrowserWindow.getFocusedWindow = () =>
        BrowserWindow.getAllWindows()[0] ?? null;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths,
      });
      BrowserWindow.getAllWindows()[0]!.webContents.send("menu:cmd", {
        type: "open-files",
      });
    },
    [file, empty],
  );
  expect(await probe.evaluate((state) => state.completion)).toEqual({
    emptyEof: true,
    rowsInTail: 1000,
    tailWrites: 1,
    errors: [],
  });
  await expect(page.locator("#countTotal")).toHaveText("3000");
  if (!(await page.locator("#filterMessage").isVisible())) {
    await page.locator(".filter-toggle-btn").click();
  }
  await page.locator("#filterMessage").fill("needle");
  await page.locator("#filterMessage").press("Enter");
  await expect(page.locator("#countFiltered")).toHaveText("1");
});
