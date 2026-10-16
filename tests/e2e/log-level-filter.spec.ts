import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { test, expect } from "./electron-fixtures";

test("applies the level matrix and preserves it across appended imports and toggles", async ({
  electronApp,
  window,
  testUserData,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const entries = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"].map(
    (level, index) => ({
      timestamp: new Date(1_700_000_000_000 + index).toISOString(),
      level,
      logger: "e2e.issue41",
      thread: "main",
      message: `matrix-${level}`,
    }),
  );
  const inputPath = path.join(testUserData, "level-matrix.ndjson");
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
  await expect(window.locator("#countTotal")).toHaveText("6");
  await window.locator(".filter-toggle-btn").click();

  const selector = window.locator("#filterLevel");
  const filteredCount = window.locator("#countFiltered");
  const rowLevels = window.locator(".row .col.lvl");
  const matrix = [
    { level: "FATAL", visible: ["FATAL"] },
    { level: "ERROR", visible: ["ERROR", "FATAL"] },
    { level: "WARN", visible: ["WARN", "ERROR", "FATAL"] },
    { level: "INFO", visible: ["INFO", "WARN", "ERROR", "FATAL"] },
    { level: "DEBUG", visible: ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"] },
    {
      level: "TRACE",
      visible: ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"],
    },
    {
      level: "",
      visible: ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"],
    },
  ];
  await expect(selector).toHaveAttribute("title", /WARN.*ERROR.*FATAL/);
  await expect(window.locator('label[for="filterLevel"]')).toHaveText(
    /^(Min\. level|Mindestlevel)$/,
  );
  for (const { level, visible } of matrix) {
    await selector.selectOption(level);
    await expect(filteredCount).toHaveText(String(visible.length));
    await expect(rowLevels).toHaveText(visible);
  }

  await selector.selectOption("WARN");
  await expect(filteredCount).toHaveText("3");
  const levelChip = window.locator(".filter-chip.level-warn");
  await expect(levelChip).toContainText(/Min\. level|Mindestlevel/);
  await expect(levelChip).toContainText("WARN");

  const appendedPath = path.join(testUserData, "level-matrix-appended.ndjson");
  await writeFile(
    appendedPath,
    [
      {
        timestamp: "2026-10-15T10:00:00Z",
        level: "INFO",
        message: "appended-info",
      },
      {
        timestamp: "2026-10-15T10:00:01Z",
        level: "ERROR",
        message: "appended-error",
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
  );
  await electronApp.evaluate(({ dialog, BrowserWindow }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
    BrowserWindow.getAllWindows()[0]!.webContents.send("menu:cmd", {
      type: "open-files",
    });
  }, appendedPath);
  await expect(window.locator("#countTotal")).toHaveText("8");
  await expect(filteredCount).toHaveText("4");
  await expect(rowLevels).toHaveText(["WARN", "ERROR", "FATAL", "ERROR"]);

  const enabled = window.getByRole("checkbox", {
    name: /Standard filters active|Standard-Filter aktiv/,
  });
  await enabled.uncheck();
  await expect(selector).toBeDisabled();
  await expect(selector).toHaveValue("WARN");
  await expect(filteredCount).toHaveText("8");
  await enabled.check();
  await expect(filteredCount).toHaveText("4");

  await window.locator("#btnClearFilters").click();
  await expect(selector).toHaveValue("");
  await expect(filteredCount).toHaveText("8");
  await expect(levelChip).toHaveCount(0);
});
