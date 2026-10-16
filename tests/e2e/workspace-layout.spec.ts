import { test, expect } from "./electron-fixtures";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

for (const theme of ["light", "dark"] as const) {
  test(`preserves inspector tab surfaces for marked entries in ${theme} mode`, async ({
    electronApp,
    window,
    testUserData,
  }) => {
    await expect(window.locator("#splash-screen")).toHaveCount(0);
    await window.evaluate(
      (themeMode) => globalThis.window.api.settingsSet({ themeMode }),
      theme,
    );
    await window.reload();
    await expect(window.locator("#splash-screen")).toHaveCount(0);
    await expect(window.locator("html")).toHaveAttribute("data-theme", theme);
    await window.setViewportSize({ width: 1440, height: 960 });
    const filePath = path.join(testUserData, "marked-entry.ndjson");
    await writeFile(
      filePath,
      JSON.stringify({
        timestamp: "2026-10-15T08:00:00.000Z",
        level: "ERROR",
        logger: "orders.PaymentGateway",
        message: "Marked entry",
        mdc: { requestId: "request-42" },
      }),
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
    await expect(window.locator("#countTotal")).toHaveText("1");
    const row = window.locator('.row[data-vi="0"]');
    await row.click();
    const inspector = window.locator(".details.inspector");
    await expect(inspector).toHaveAttribute("data-tinted", "0");
    await row.click({ button: "right" });
    await window.locator(".context-menu .colors .swatch").first().click();
    await expect(inspector).toHaveAttribute("data-tinted", "1");

    for (const layout of ["bottom", "right"]) {
      await window.locator(`#layout-${layout}`).click();
      await expect(window.locator(".layout")).toHaveAttribute(
        "data-detail-layout",
        layout,
      );
      await expect(inspector).not.toHaveCSS("background-image", "none");
      const tabs = inspector.getByRole("tab");
      for (let index = 0; index < (await tabs.count()); index++) {
        const tab = tabs.nth(index);
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(inspector.getByRole("tabpanel")).toBeVisible();
        // Move off the tab to distinguish its normal surface from hover.
        await window.mouse.move(0, 0);
        for (const sibling of await tabs.all()) {
          await expect(sibling).toHaveCSS(
            "background-color",
            "rgba(0, 0, 0, 0)",
          );
        }
        await tab.hover();
        const hoverColor = await tab.evaluate((element) => {
          const probe = document.createElement("span");
          probe.style.color = "var(--color-bg-hover)";
          element.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        });
        await expect(tab).toHaveCSS("background-color", hoverColor);
      }
    }
  });
}

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
  await expect(
    window.getByRole("tab", { name: /Rohdaten|Raw data/ }),
  ).toHaveCount(0);
  await window.getByRole("tab", { name: /Erweitert|Advanced/ }).click();
  await expect(window.locator(".inspector-raw")).toHaveJSProperty(
    "open",
    false,
  );
  await expect(window.getByRole("tabpanel").locator("pre")).toHaveCount(0);
  await window.locator(".inspector-raw summary").click();
  await expect(window.getByRole("tabpanel")).toContainText("Payment timeout 0");
  await expect(window.getByRole("tabpanel")).toContainText("request-1");
  await window.locator(".inspector-raw summary").click();
  await expect(window.getByRole("tabpanel").locator("pre")).toHaveCount(0);
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
