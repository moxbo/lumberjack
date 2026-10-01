import { test, expect } from "./electron-fixtures";

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
