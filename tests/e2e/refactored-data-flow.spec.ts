import { test, expect } from "./electron-fixtures";
import { readFile, writeFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import type { ElectronApplication } from "@playwright/test";

async function sendMenu(electronApp: ElectronApplication, type: string) {
  await electronApp.evaluate(({ BrowserWindow }, command) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Missing test window");
    window.webContents.send("menu:cmd", { type: command });
  }, type);
}

test("imports paged rows, filters and streams the current view in every format", async ({
  electronApp,
  window,
  testUserData,
}) => {
  const entries = Array.from({ length: 600 }, (_, index) => ({
    timestamp: new Date(1_700_000_000_000 + index).toISOString(),
    level: index % 2 === 0 ? "INFO" : "ERROR",
    logger: "e2e.streaming",
    message: `entry-${index} ${"\u00e9\ud83e\udeb5".repeat(120)}`,
  }));
  const inputPath = path.join(testUserData, "input.ndjson");
  await writeFile(
    inputPath,
    entries.map((entry) => JSON.stringify(entry)).join("\n"),
  );
  await expect(window.locator("#countTotal")).toHaveText("0");
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await electronApp.evaluate(({ dialog, BrowserWindow }, filePath) => {
    // Native dialogs are mocked; do not depend on the OS granting test-window focus.
    BrowserWindow.getFocusedWindow = () =>
      BrowserWindow.getAllWindows()[0] ?? null;
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, inputPath);
  await sendMenu(electronApp, "open-files");
  await expect(window.locator("#countTotal")).toHaveText("600");
  await expect(window.locator(".row .col.msg").first()).toContainText(
    "entry-0",
  );

  for (const format of ["ndjson", "json", "csv", "md", "txt", "html"]) {
    const outputPath = path.join(testUserData, `export.${format}`);
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, outputPath);
    await sendMenu(electronApp, "export-view");
    await expect
      .poll(async () =>
        (await readdir(testUserData)).includes(`export.${format}`),
      )
      .toBe(true);
    const content = await readFile(outputPath, "utf8");
    expect(content).toContain("entry-0 ");
    expect(content).toContain("entry-599 ");
    if (format === "ndjson" || format === "json") {
      const exported: Array<{ message: string }> =
        format === "json"
          ? JSON.parse(content)
          : content
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line));
      expect(exported.map((entry) => entry.message)).toEqual(
        entries.map((entry) => entry.message),
      );
    }
  }

  await window.locator(".filter-toggle-btn").click();
  await window.locator("#filterLevel").selectOption("ERROR");
  await expect(window.locator("#countFiltered")).toHaveText("300");
  const filteredPath = path.join(testUserData, "filtered.ndjson");
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, filteredPath);
  await sendMenu(electronApp, "export-view");
  await expect
    .poll(async () => (await readdir(testUserData)).includes("filtered.ndjson"))
    .toBe(true);
  const filtered = (await readFile(filteredPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(filtered).toHaveLength(300);
  expect(
    filtered.every((entry: { level: string }) => entry.level === "ERROR"),
  ).toBe(true);
  expect(
    (await readdir(testUserData)).some((file) => file.endsWith(".part")),
  ).toBe(false);
});

test("settings hook saves and reloads the modal without touching the real profile", async ({
  electronApp,
  window,
  testUserData,
}) => {
  await expect(window.locator("#countTotal")).toHaveText("0");
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const actualProfile = await electronApp.evaluate(({ app }) =>
    app.getPath("userData"),
  );
  expect(actualProfile).toBe(testUserData);
  await sendMenu(electronApp, "open-settings");
  await window
    .getByRole("tab", { name: /^(Connections|Verbindungen)$/ })
    .click();
  await window.locator("#tcp-port").fill("54321");
  await window.getByRole("button", { name: /^(Save|Speichern)$/ }).click();
  await expect(window.locator("#tcp-port")).not.toBeVisible();
  await sendMenu(electronApp, "open-settings");
  await window
    .getByRole("tab", { name: /^(Connections|Verbindungen)$/ })
    .click();
  await expect(window.locator("#tcp-port")).toHaveValue("54321");
  const settings: { tcpPort: number } = JSON.parse(
    await readFile(path.join(testUserData, "settings.json"), "utf8"),
  );
  expect(settings.tcpPort).toBe(54321);
});
