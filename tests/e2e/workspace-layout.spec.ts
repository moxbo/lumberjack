import { test, expect } from "./electron-fixtures";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

test("switches and restores layouts independently of theme, with accessible resizing", async ({
  window,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await window.setViewportSize({ width: 1440, height: 960 });
  await window.evaluate(() =>
    globalThis.window.api.settingsSet({ themeMode: "light" }),
  );
  await window.reload();
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await expect(window.locator("html")).toHaveAttribute("data-theme", "light");
  await window.locator("#layout-right").click();
  const layout = window.locator(".layout");
  await expect(layout).toHaveAttribute("data-detail-layout", "right");
  await expect(window.locator("#layout-right")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(window.locator("html")).toHaveAttribute("data-theme", "light");
  const divider = window.getByRole("separator");
  await expect(divider).toHaveAttribute("aria-orientation", "vertical");
  await divider.focus();
  const initialWidth = await window
    .locator(".overlay")
    .evaluate((el) => el.clientWidth);
  await divider.press("ArrowLeft");
  await expect
    .poll(() => window.locator(".overlay").evaluate((el) => el.clientWidth))
    .toBe(initialWidth + 20);
  await expect
    .poll(
      async () =>
        (await window.evaluate(() => globalThis.window.api.settingsGet()))
          .settings?.detailWidth,
    )
    .toBe(initialWidth + 12);
  await window.evaluate(() =>
    globalThis.window.api.settingsSet({ themeMode: "dark" }),
  );
  await window.reload();
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await expect(layout).toHaveAttribute("data-detail-layout", "right");
  await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(window.locator(".overlay")).toHaveJSProperty(
    "clientWidth",
    initialWidth + 20,
  );
  await window.setViewportSize({ width: 600, height: 800 });
  await expect(layout).toHaveAttribute("data-detail-layout", "bottom");
  await expect(window.locator("#layout-right")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await window.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await window.setViewportSize({ width: 1440, height: 960 });
  await expect(layout).toHaveAttribute("data-detail-layout", "right");
  await window.locator("#layout-bottom").click();
  await expect(divider).toHaveAttribute("aria-orientation", "horizontal");
  await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
  const initialHeight = await window
    .locator(".overlay")
    .evaluate((el) => el.clientHeight);
  await divider.press("ArrowUp");
  await expect
    .poll(() => window.locator(".overlay").evaluate((el) => el.clientHeight))
    .toBe(initialHeight + 20);

  await window.evaluate(() =>
    document.documentElement.style.setProperty("--col-logger", "800px"),
  );
  const loggerHeader = window.locator(".list-header .cell").nth(2);
  const initialLoggerWidth = await loggerHeader.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  const handle = await loggerHeader.locator(".resizer").boundingBox();
  if (!handle) throw new Error("Logger resize handle is missing");
  await window.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await window.mouse.down();
  await window.mouse.move(
    handle.x + handle.width / 2 - 60,
    handle.y + handle.height / 2,
  );
  await window.mouse.up();
  await expect
    .poll(() => loggerHeader.evaluate((el) => el.getBoundingClientRect().width))
    .toBeCloseTo(initialLoggerWidth - 60, 0);
});

test("keeps search, filters and real inspector data usable in both layouts", async ({
  electronApp,
  window,
  testUserData,
}) => {
  await window.setViewportSize({ width: 1440, height: 960 });
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const filePath = path.join(testUserData, "workspace.ndjson");
  await writeFile(
    filePath,
    Array.from({ length: 50 }, (_, index) =>
      JSON.stringify({
        timestamp: new Date(1_700_000_000_000 + index * 1000).toISOString(),
        level: index % 2 ? "INFO" : "ERROR",
        logger: "orders.PaymentGateway",
        thread: "request-1",
        message: `Payment timeout ${index}`,
        stack_trace: "java.net.SocketTimeoutException: Read timed out",
        mdc: { requestId: "request-42" },
      }),
    ).join("\n"),
  );
  await electronApp.evaluate(({ dialog, BrowserWindow }, input) => {
    BrowserWindow.getFocusedWindow = () =>
      BrowserWindow.getAllWindows()[0] ?? null;
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [input],
    });
  }, filePath);
  await window.locator("#btnOpenLogs").click();
  await expect(window.locator("#countTotal")).toHaveText("50");
  await window.locator('.row[data-vi="0"]').click();
  await expect(window.locator("#dMessage")).toContainText("Payment timeout 0");
  await window.locator("#layout-right").click();
  await expect(window.locator("#dMessage")).toBeVisible();
  await window.getByRole("tab", { name: "Stacktrace", exact: true }).click();
  await expect(window.getByRole("tabpanel")).toContainText(
    "SocketTimeoutException",
  );
  await window.getByRole("tab", { name: /Kontext|Context/ }).click();
  await expect(window.getByRole("tabpanel")).toContainText("request-1");
  await window.getByRole("tab", { name: /Rohdaten|Raw data/ }).click();
  await expect(window.getByRole("tabpanel")).toContainText("Payment timeout 0");
  await expect(window.getByRole("tabpanel")).toContainText("request-1");
  await window
    .getByRole("tab", { name: /Nachricht|Message/, exact: true })
    .click();
  await window
    .getByRole("button", { name: /Details schließen|Close details/ })
    .click();
  await expect(window.locator(".overlay")).toBeHidden();
  await window.locator('.row[data-vi="1"]').click();
  await expect(window.locator("#dMessage")).toContainText("Payment timeout 1");
  await window.locator("#searchText").fill('"timeout 3"');
  await window.locator("#searchText").press("Enter");
  await expect(window.locator("#btnPrevMatch + span")).toHaveText("1/11");
  await expect(window.locator("#countFiltered")).toHaveText("50");
  if (!(await window.locator("#filterLevel").isVisible()))
    await window.locator(".filter-toggle-btn").click();
  await window.locator("#filterLevel").selectOption("ERROR");
  await expect(window.locator("#countFiltered")).toHaveText("25");
  await expect(
    window.locator(".workspace-filterbar .filter-chip"),
  ).toContainText("ERROR");
  await window.locator(".workspace-filterbar .chip-remove").click();
  await expect(window.locator("#countFiltered")).toHaveText("50");
  await window.locator("#layout-bottom").click();
  await expect(window.locator(".inspector")).toBeVisible();
});
