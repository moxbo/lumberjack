import { test, expect } from "./electron-fixtures";
import type { Locator } from "@playwright/test";

test("list and filter Elasticsearch actions prefill the same current search values", async ({
  window,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await window.evaluate(() =>
    globalThis.window.api.settingsSet({
      histAppName: ["payments-service", "older-service"],
      histEnvironment: ["staging", "production"],
      histIndex: ["app-logs-*", "older-logs-*"],
      lastEnvironmentCase: "lower",
      lastTimestampField: "event.created",
    }),
  );
  await window.reload();
  await expect(window.locator("#splash-screen")).toHaveCount(0);

  const dialog = window.locator(".modal").filter({
    has: window.locator(".es-dialog-section"),
  });
  const listAction = window.locator(".list-empty-actions").getByRole("button", {
    name: /Elastic/i,
  });
  const application = dialog.getByPlaceholder(/my-app/);
  const environment = dialog.getByPlaceholder(/production/);
  const index = dialog.getByPlaceholder(/logs-\*/);
  const timestampField = dialog.getByPlaceholder("@timestamp", { exact: true });
  const advanced = dialog.locator(".es-dialog-section").last();
  const environmentCase = advanced.locator("select");
  const cancel = dialog.getByRole("button", { name: /^(Cancel|Abbrechen)$/ });

  await listAction.click();
  await expect(application).toHaveValue("payments-service");
  await expect(environment).toHaveValue("staging");
  await advanced.locator(".es-dialog-section-header").click();
  await expect(index).toHaveValue("app-logs-*");
  await expect(environmentCase).toHaveValue("lower");
  await expect(timestampField).toHaveValue("event.created");
  const readFormValues = () =>
    dialog.locator("input, select").evaluateAll((elements) =>
      elements.map((element) => {
        if (element instanceof HTMLInputElement) {
          return {
            value: element.value,
            checked: element.checked,
            type: element.type,
          };
        }
        if (element instanceof HTMLSelectElement) {
          return { value: element.value, type: element.type };
        }
        throw new Error("Unexpected Elasticsearch form control");
      }),
    );
  const initialValues = await readFormValues();
  await application.fill("unsaved-service");
  await index.fill("unsaved-index-*");
  await cancel.click();
  await expect(dialog).toHaveCount(0);

  await window.locator(".filter-toggle-btn").click();
  await window
    .locator(".filter-section")
    .getByRole("button", {
      name: /Elastic/i,
    })
    .click();
  await expect(application).toHaveValue("payments-service");
  await advanced.locator(".es-dialog-section-header").click();
  await expect(index).toHaveValue("app-logs-*");
  const filterValues = await readFormValues();
  expect(filterValues).toEqual(initialValues);
  await cancel.click();

  await window.evaluate(() =>
    globalThis.window.api.settingsSet({
      lastEnvironmentCase: "upper",
      lastTimestampField: "event.updated",
    }),
  );
  await listAction.click();
  await advanced.locator(".es-dialog-section-header").click();
  await expect(environmentCase).toHaveValue("upper");
  await expect(timestampField).toHaveValue("event.updated");
});

test("Elasticsearch inputs preserve editing positions across window focus notifications", async ({
  electronApp,
  window,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await window
    .locator(".list-empty-actions")
    .getByRole("button", { name: /Elastic/i })
    .click();
  const dialog = window.locator(".modal").filter({
    has: window.locator(".es-dialog-section"),
  });
  await dialog.locator('input[name="esMode"][value="absolute"]').check();

  const restoreWindowFocus = async (input: Locator) => {
    await input.evaluate((element) => {
      element.setAttribute("data-blur-events", "0");
      element.setAttribute("data-focus-notifications", "0");
      element.addEventListener("blur", () => {
        element.setAttribute(
          "data-blur-events",
          String(Number(element.getAttribute("data-blur-events")) + 1),
        );
      });
      const off = globalThis.window.api.onWindowFocus(() => {
        const count =
          Number(element.getAttribute("data-focus-notifications")) + 1;
        element.setAttribute("data-focus-notifications", String(count));
        if (count === 2) off();
      });
    });
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error("Missing application window");
      win.webContents.focus();
      win.webContents.send("window:focus");
      win.webContents.send("window:focus");
    });
    await expect(input).toHaveAttribute("data-focus-notifications", "2");
    await window.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(input).toHaveAttribute("data-blur-events", "0");
    await expect(input).toBeFocused();
  };

  const dates = dialog.locator('input[type="datetime-local"]');
  await expect(dates).toHaveCount(2);
  for (const date of await dates.all()) {
    await date.fill("2026-11-01T12:34");
    await date.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) {
        throw new Error("Expected a date input");
      }
      element.blur();
      element.focus();
    });
    for (let segment = 0; segment < 4; segment++) {
      await window.keyboard.press("ArrowRight");
    }
    await window.keyboard.press("ArrowUp");
    await expect(date).toHaveValue("2026-11-01T12:35");
    await restoreWindowFocus(date);
    await window.keyboard.press("ArrowUp");
    await expect(date).toHaveValue("2026-11-01T12:36");
  }

  const application = dialog.getByPlaceholder(/my-app/);
  await application.fill("payments-service");
  await application.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error("Expected an application input");
    }
    element.setSelectionRange(0, 8);
  });
  await restoreWindowFocus(application);
  expect(
    await application.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) {
        throw new Error("Expected an application input");
      }
      return [element.selectionStart, element.selectionEnd];
    }),
  ).toEqual([0, 8]);
  await window.keyboard.type("orders");
  await expect(application).toHaveValue("orders-service");
});
