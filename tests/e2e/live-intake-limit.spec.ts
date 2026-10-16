import { createServer } from "node:http";
import { createConnection, createServer as createTcpServer } from "node:net";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { test, expect } from "./electron-fixtures";
import type { TcpStatus } from "../../src/types/ipc";

test("pauses live intake at its configured limit without limiting imports or deleting data", async ({
  electronApp,
  window,
  testUserData,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const status = window.locator(".live-intake-status");
  await expect(status.locator("meter")).toHaveAttribute("max", "500000");
  await expect(status.locator(".live-intake-value")).toHaveAttribute(
    "stroke-dashoffset",
    "100",
  );
  const configureLimit = async (limit: number) => {
    await status.getByRole("button").hover();
    const tooltip = window.locator(".portal-tooltip--interactive");
    await tooltip.getByRole("button").click();
    const dialog = window.getByRole("dialog", {
      name: /^(Settings|Einstellungen)$/,
    });

    await dialog.locator("#liveEntryLimit").fill(String(limit));
    await dialog.getByRole("button", { name: /^(Save|Speichern)$/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(status.locator("meter")).toHaveAttribute("max", String(limit));
    expect(
      (await window.evaluate(() => globalThis.window.api.settingsGet()))
        .settings?.liveEntryLimit,
    ).toBe(limit);
  };
  await configureLimit(3);

  const records = Array.from({ length: 8 }, (_, index) => ({
    timestamp: new Date(1_700_000_000_000 + index).toISOString(),
    level: "INFO",
    logger: "e2e.live-limit",
    message: `network-${index}`,
  }));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/x-ndjson" });
    response.end(
      records.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing HTTP test server port");
  const url = `http://127.0.0.1:${address.port}/live.ndjson`;
  const startPoll = () =>
    window.evaluate(
      (url) => globalThis.window.api.httpStartPoll({ url, intervalSec: 1 }),
      url,
    );
  const dismissSourceError = async () => {
    const alert = window.locator(".modal-alert");
    if (await alert.count())
      await alert.getByRole("button", { name: "OK", exact: true }).click();
  };
  try {
    expect((await startPoll()).ok).toBe(true);
    await expect(window.locator("#countTotal")).toHaveText("3");
    await expect(status).toHaveAttribute("data-paused", "true");
    await expect(status.locator("meter")).toHaveAttribute("value", "3");
    await expect(status.getByRole("status")).toContainText(/pausiert|paused/);
    await expect.poll(async () => (await startPoll()).ok).toBe(false);
    await dismissSourceError();
    await status.getByRole("button").hover();
    await expect(window.locator(".live-intake-tooltip")).toContainText(
      /verloren|lost/,
    );
    await expect(status.locator(".live-intake-value")).toHaveAttribute(
      "stroke-dashoffset",
      "0",
    );
    await expect(window.locator(".workspace-storage-error")).toHaveCount(0);

    const inputPath = path.join(testUserData, "import.ndjson");
    await writeFile(
      inputPath,
      records
        .map((entry, index) =>
          JSON.stringify({
            ...entry,
            message: `file-${index}`,
            source: "tcp:exported",
            _ingestionKind: "live",
          }),
        )
        .join("\n"),
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
    await expect(window.locator("#countTotal")).toHaveText("11");
    await expect(status.locator("meter")).toHaveAttribute("value", "3");

    const loaded = await window.evaluate(
      (url) => globalThis.window.api.httpLoadOnce(url),
      url.replace("/live.ndjson", "/manual.ndjson"),
    );
    expect(loaded.ok).toBe(true);
    await expect(window.locator("#countTotal")).toHaveText("19");
    await expect(status.locator("meter")).toHaveAttribute("value", "3");
    await expect(status).toHaveAttribute("data-paused", "true");

    await configureLimit(2);
    await expect(status.locator("meter")).toHaveAttribute(
      "aria-valuetext",
      /3 \/ 2$/,
    );
    await expect(status.locator(".live-intake-value")).toHaveAttribute(
      "stroke-dashoffset",
      "0",
    );
    await expect(status).toHaveAttribute("data-paused", "true");

    await configureLimit(5);
    await expect(status).toHaveAttribute("data-paused", "false");
    await expect(status.locator(".live-intake-value")).toHaveAttribute(
      "stroke-dashoffset",
      "40",
    );
    await expect(window.locator("#countTotal")).toHaveText("19");
    await expect.poll(async () => (await startPoll()).ok).toBe(true);
    await expect(window.locator("#countTotal")).toHaveText("21");
    await expect(status.locator("meter")).toHaveAttribute("value", "5");
    await expect(status).toHaveAttribute("data-paused", "true");
    await expect.poll(async () => (await startPoll()).ok).toBe(false);
    await dismissSourceError();

    await window
      .getByRole("button", { name: /^(Clear Logs|Logs leeren)$/ })
      .click();
    await window.getByRole("button", { name: "OK", exact: true }).click();
    await expect(window.locator("#countTotal")).toHaveText("0");
    await expect(status.locator("meter")).toHaveAttribute("value", "0");
    await expect(status).toHaveAttribute("data-paused", "false");
    await expect.poll(async () => (await startPoll()).ok).toBe(true);
    await expect(window.locator("#countTotal")).toHaveText("5");
    await expect(status).toHaveAttribute("data-paused", "true");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("keeps the live indicator inline with an accessible settings tooltip", async ({
  window,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const status = window.locator(".workspace-infobar > .live-intake-status");
  const trigger = status.getByRole("button");
  const tooltip = window.locator(".portal-tooltip--interactive");
  await expect(status.locator("svg")).toBeVisible();
  const countsBox = await window.locator("#countTotal").boundingBox();
  const indicatorBox = await trigger.boundingBox();
  expect(countsBox).not.toBeNull();
  expect(indicatorBox).not.toBeNull();
  expect(Math.abs(countsBox!.y - indicatorBox!.y)).toBeLessThan(15);

  await trigger.hover();
  await expect(tooltip).toContainText(
    /^(Live entries|Live-Einträge): 0 \/ 500[.,]000/,
  );
  await tooltip.hover();
  await expect(tooltip.getByRole("button")).toBeVisible();
  await window.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();

  await trigger.focus();
  await expect(tooltip).toBeVisible();
  await window.keyboard.press("Tab");
  await expect(tooltip.getByRole("button")).toBeFocused();
  await window.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  await window.keyboard.press("Tab");
  await expect(tooltip.getByRole("button")).toBeFocused();
  await window.keyboard.press("Tab");
  await expect(window.locator(".workspace-follow input")).toBeFocused();
  await expect(tooltip).toBeHidden();

  await trigger.focus();
  await window.keyboard.press("Tab");
  await window.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  const dialog = window.getByRole("dialog", {
    name: /^(Settings|Einstellungen)$/,
  });
  await expect(dialog.locator("#liveEntryLimit")).toBeVisible();
});

test("stops TCP reception and rejects source restarts while the limit is reached", async ({
  window,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const saved = await window.evaluate(() =>
    globalThis.window.api.settingsSet({ liveEntryLimit: 2 }),
  );
  expect(saved.ok).toBe(true);
  await window.reload();
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await expect(window.locator(".live-intake-status meter")).toHaveAttribute(
    "max",
    "2",
  );

  const probe = createTcpServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Missing TCP test port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  const startTcp = () =>
    window.evaluate(
      (port) =>
        new Promise<TcpStatus>((resolve) => {
          const api = globalThis.window.api;
          const off = api.onTcpStatus((status) => {
            off();
            resolve(status);
          });
          api.tcpStart(port);
        }),
      port,
    );
  expect((await startTcp()).ok).toBe(true);
  const socket = createConnection({ host: "127.0.0.1", port });
  const closed = new Promise<void>((resolve) =>
    socket.once("close", () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.write(
          Array.from({ length: 5 }, (_, index) =>
            JSON.stringify({
              timestamp: new Date(1_700_000_000_000 + index).toISOString(),
              level: "INFO",
              message: `tcp-${index}`,
            }),
          ).join("\n") + "\n",
          (error) => (error ? reject(error) : resolve()),
        );
      });
    });
    await expect(window.locator("#countTotal")).toHaveText("2");
    await expect(window.locator(".live-intake-status")).toHaveAttribute(
      "data-paused",
      "true",
    );
    await closed;
    await expect.poll(startTcp).toMatchObject({
      ok: false,
      message: expect.stringMatching(/paused|pausiert/i),
    });
    const connectionError = await new Promise<string | undefined>(
      (resolve, reject) => {
        const connection = createConnection({ host: "127.0.0.1", port });
        connection.once("connect", () => {
          connection.destroy();
          reject(
            new Error("The paused TCP listener still accepts connections"),
          );
        });
        connection.once("error", (error: NodeJS.ErrnoException) =>
          resolve(error.code),
        );
      },
    );
    expect(connectionError).toBe("ECONNREFUSED");
    await expect(window.locator("#countTotal")).toHaveText("2");
    await expect(window.locator(".workspace-storage-error")).toHaveCount(0);
  } finally {
    socket.destroy();
  }
});

test("a rejected live batch does not cancel a concurrent manual HTTP import", async ({
  window,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  const saved = await window.evaluate(() =>
    globalThis.window.api.settingsSet({ liveEntryLimit: 3 }),
  );
  expect(saved.ok).toBe(true);
  await window.reload();
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await expect(window.locator(".live-intake-status meter")).toHaveAttribute(
    "max",
    "3",
  );

  const responses: Array<() => void> = [];
  const server = createServer((request, response) => {
    const live = request.url === "/live.ndjson";
    responses.push(() => {
      response.writeHead(200, { "Content-Type": "application/x-ndjson" });
      response.end(
        Array.from({ length: live ? 6 : 4 }, (_, index) =>
          JSON.stringify({
            timestamp: new Date(1_700_000_000_000 + index).toISOString(),
            level: "INFO",
            message: `${live ? "live" : "import"}-${index}`,
            _ingestionKind: live ? "import" : "live",
          }),
        ).join("\n") + "\n",
      );
    });
    if (responses.length === 2)
      for (const respond of responses.splice(0)) respond();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing concurrent HTTP test server port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const [poll, imported] = await window.evaluate(
      (baseUrl) =>
        Promise.all([
          globalThis.window.api.httpStartPoll({
            url: `${baseUrl}/live.ndjson`,
            intervalSec: 1,
          }),
          globalThis.window.api.httpLoadOnce(`${baseUrl}/import.ndjson`),
        ]),
      baseUrl,
    );
    expect(poll.ok).toBe(true);
    expect(imported, JSON.stringify(imported)).toMatchObject({ ok: true });
    await expect(window.locator("#countTotal")).toHaveText("7");
    await expect(window.locator(".live-intake-status meter")).toHaveAttribute(
      "value",
      "3",
    );
    await expect(window.locator(".live-intake-status")).toHaveAttribute(
      "data-paused",
      "true",
    );
    await expect(window.locator(".workspace-storage-error")).toHaveCount(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
