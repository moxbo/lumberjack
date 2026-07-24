import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { test, expect } from "./electron-fixtures";

test.describe("Stacktrace details", () => {
  test("shows an offloaded stacktrace for the selected entry", async ({
    electronApp,
    window,
  }) => {
    const message = `E2E stacktrace ${Date.now()}`;
    const stackTrace = [
      "java.lang.IllegalStateException: E2E_STACKTRACE_START",
      ...Array.from(
        { length: 100 },
        (_, index) =>
          `\tat com.example.service.PaymentService.process(PaymentService.java:${index + 1})`,
      ),
      "\tat com.example.Application.main(Application.java:42) E2E_STACKTRACE_END",
    ].join("\n");
    const logPath = path.join(
      os.tmpdir(),
      `lumberjack-stacktrace-${Date.now()}.json`,
    );

    fs.writeFileSync(
      logPath,
      JSON.stringify([
        {
          timestamp: "2026-07-24T10:00:00.000Z",
          level: "ERROR",
          logger: "com.example.service.PaymentService",
          message,
          stackTrace,
        },
      ]),
    );

    try {
      await expect(window.locator("#splash-screen")).toBeHidden({
        timeout: 30000,
      });
      await electronApp.evaluate(
        async ({ dialog }, { testPath }) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [testPath],
          });
        },
        { testPath: logPath },
      );

      await window.locator(".list-empty-actions .btn-primary").click();

      const row = window.locator(".row", { hasText: message });
      await expect(row).toBeVisible({ timeout: 30000 });
      await row.click();

      const displayedStackTrace = window.locator(".details .stack-trace");
      await expect(displayedStackTrace).toBeVisible();
      await expect(displayedStackTrace).toContainText("E2E_STACKTRACE_START");
      await expect(displayedStackTrace).toContainText("E2E_STACKTRACE_END");
    } finally {
      fs.rmSync(logPath, { force: true });
    }
  });
});
