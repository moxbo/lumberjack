import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, openLogFiles, test } from "./electron-fixtures";

test("records actual filters only after opt-in and saves a content-free JSON report", async ({
  electronApp,
  window: page,
  testUserData,
}) => {
  await expect(page.locator("#splash-screen")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 960 });
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.show();
    win.focus();
  });
  await page.bringToFront();
  const input = join(testUserData, "private-source.ndjson");
  await writeFile(
    input,
    ["private-alpha", "private-beta"]
      .map((message) =>
        JSON.stringify({
          timestamp: "2026-03-01T00:00:00Z",
          level: "INFO",
          logger: "private-logger",
          message,
        }),
      )
      .join("\n"),
  );
  await openLogFiles(electronApp, [input]);
  await expect(page.locator("#countTotal")).toHaveText("2");
  const dialog = page.getByRole("dialog", {
    name: /^(Settings|Einstellungen)$/,
  });
  const openSettings = async () => {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send("menu:cmd", {
        type: "open-settings",
      }),
    );
    await dialog.locator("#settings-tab-advanced").click();
  };
  const checkbox = dialog.locator("#filterDiagnosticsEnabled");
  const save = async () => {
    await dialog.getByRole("button", { name: /^(Save|Speichern)$/ }).click();
    await expect(dialog).toHaveCount(0);
  };
  const cancel = async () => {
    await dialog.getByRole("button", { name: /^(Cancel|Abbrechen)$/ }).click();
    await expect(dialog).toHaveCount(0);
  };
  const exportButton = dialog.getByRole("button", { name: /JSON/ });
  const filter = async (query: string, count: number) => {
    const field = page.locator("#filterMessage");
    if (!(await field.isVisible()))
      await page.locator(".filter-toggle-btn").click();
    await field.fill(query);
    await field.press("Enter");
    await expect(page.locator("#countFiltered")).toHaveText(String(count));
    if (count)
      await expect(page.locator(".row .col.msg").first()).toHaveText(query);
    else await expect(page.locator(".list-empty-title")).toBeInViewport();
    await expect(page.locator(".filter-progress")).toHaveCount(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  };
  await openSettings();
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await cancel();
  await filter("private-alpha", 1);
  await openSettings();
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await save();
  await openSettings();
  await expect(checkbox).toBeChecked();
  await expect(exportButton).toBeDisabled();
  await cancel();
  await filter("private-beta", 1);
  await filter("private-absent", 0);
  await openSettings();
  await expect(
    dialog.locator(".filter-diagnostics-table caption"),
  ).toContainText(/: 2 ·/);

  const output = join(testUserData, "report.json");
  await electronApp.evaluate(({ dialog }, path) => {
    let invocation = 0;
    dialog.showSaveDialog = async (
      first,
      second?: Electron.SaveDialogOptions,
    ) => {
      const options = second ?? first;
      if (
        !("defaultPath" in options) ||
        !String(options.defaultPath).endsWith(".json") ||
        JSON.stringify(options.filters) !==
          JSON.stringify([{ name: "JSON", extensions: ["json"] }])
      )
        throw new Error("Unexpected diagnostics export dialog");
      invocation++;
      return {
        canceled: invocation === 1,
        filePath: invocation === 2 ? `${path}/invalid-file` : path,
      };
    };
  }, output);
  await exportButton.click();
  await expect(exportButton).toBeEnabled();
  await expect(dialog.getByRole("status")).toBeEmpty();
  await exportButton.click();
  await expect(dialog.getByRole("status")).toContainText(/ENOENT/);
  await exportButton.click();
  await expect(dialog.getByRole("status")).toContainText(/exported|exportiert/);
  const json = await readFile(output, "utf8");
  expect(json).not.toContain("private-");
  expect(json).not.toContain(testUserData);
  const report = JSON.parse(json);
  expect(report).toEqual({
    schemaVersion: 1,
    unit: "ms",
    samples: [1, 0].map((resultCount) => ({
      trigger: "new-view",
      inputCount: 2,
      resultCount,
      firstVisibleMs: expect.any(Number),
      finalListMs: expect.any(Number),
      longestTaskMs: expect.any(Number),
    })),
  });
  await checkbox.uncheck();
  await save();
  await openSettings();
  await expect(checkbox).not.toBeChecked();
  await expect(exportButton).toHaveCount(0);
  await checkbox.check();
  await save();
  await openSettings();
  await expect(exportButton).toBeDisabled();
});
