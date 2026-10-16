import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import * as path from "node:path";
import type { TcpStatus } from "../../src/types/ipc";
import { test, expect } from "./electron-fixtures";

for (const source of ["tcp", "file"] as const) {
  test(`preserves a complete large JSON message through ${source}, full view and clear`, async ({
    electronApp,
    window,
    testUserData,
  }) => {
    await expect(window.locator("#splash-screen")).toHaveCount(0);
    const message =
      "<root>" +
      "x".repeat(13 * 1024 * 1024) +
      '\n<tail quote="complete">\u00fc\u{1f600}&</tail></root>';
    const expectedHash = createHash("sha256").update(message).digest("hex");
    const record = {
      "@timestamp": "2026-10-15T06:21:26.613Z",
      level: "INFO",
      logger_name: "e2e.issue44",
      thread_name: "worker-44",
      message,
    };
    const line = JSON.stringify(record) + "\n";
    let socket: Socket | undefined;
    const socketErrors: Error[] = [];
    const automaticLogPath = path.join(testUserData, "automatic.ndjson");
    try {
      if (source === "tcp") {
        expect(
          (
            await window.evaluate(
              (logFilePath) =>
                globalThis.window.api.settingsSet({
                  logToFile: true,
                  logFilePath,
                  logMaxBytes: 1024 * 1024,
                  logMaxBackups: 2,
                }),
              automaticLogPath,
            )
          ).ok,
        ).toBe(true);
        const probe = createServer();
        await new Promise<void>((resolve) =>
          probe.listen(0, "127.0.0.1", resolve),
        );
        const address = probe.address();
        await new Promise<void>((resolve, reject) =>
          probe.close((error) => (error ? reject(error) : resolve())),
        );
        if (!address || typeof address === "string")
          throw new Error("Missing TCP test port");
        const status = await window.evaluate(
          (port) =>
            new Promise<TcpStatus>((resolve) => {
              const api = globalThis.window.api;
              const off = api.onTcpStatus((status) => {
                off();
                resolve(status);
              });
              api.tcpStart(port);
            }),
          address.port,
        );
        expect(status.ok).toBe(true);
        socket = createConnection({ host: "127.0.0.1", port: address.port });
        socket.on("error", (error) => socketErrors.push(error));
        await once(socket, "connect");
        socket.write(line);
      } else {
        const filePath = path.join(testUserData, "issue-44.ndjson");
        await writeFile(filePath, line);
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
        }, filePath);
      }

      await expect(window.locator("#countTotal")).toHaveText("1");
      const stored = await window.evaluate(async () => {
        for (const { name } of await indexedDB.databases()) {
          if (!name?.startsWith("LumberjackPagedLogs-")) continue;
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () =>
              reject(request.error ?? new Error("Opening log storage failed"));
          });
          try {
            if (!db.objectStoreNames.contains("payloads")) continue;
            const transaction = db.transaction(["payloads", "projections"]);
            const read = <T>(store: string) =>
              new Promise<T>((resolve, reject) => {
                const request = transaction.objectStore(store).get(1);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () =>
                  reject(
                    request.error ?? new Error("Reading stored entry failed"),
                  );
              });
            const [payload, projection] = await Promise.all([
              read<
                import("../../src/store/paged/types").PayloadRecord | undefined
              >("payloads"),
              read<
                | import("../../src/store/paged/types").ProjectionRecord
                | undefined
              >("projections"),
            ]);
            if (typeof payload?.entry._payloadRef === "string" && projection) {
              return {
                reference: payload.entry._payloadRef,
                previewLength: projection.message.length,
                messageSize: payload.entry._messageSize,
                fullMessageStoredInline: "_fullMessage" in payload.entry,
                rawStoredInline: "raw" in payload.entry,
              };
            }
          } finally {
            db.close();
          }
        }
        throw new Error("Missing retained payload in the active log database");
      });
      expect(stored.previewLength).toBeLessThan(55 * 1024);
      expect(stored.messageSize).toBe(Buffer.byteLength(message));
      expect(stored.fullMessageStoredInline).toBe(false);
      expect(stored.rawStoredInline).toBe(false);

      await window.locator(".row").first().click();
      await expect(window.locator(".inspector-logger")).toHaveText(
        "e2e.issue44",
      );
      await expect(window.locator(".inspector-level")).toHaveText("INFO");
      await expect(window.locator(".inspector-metadata")).toContainText(
        "worker-44",
      );
      await expect(window.locator(".inspector-timestamp")).toContainText(
        "2026",
      );
      const displayed = window.locator("#dMessage");
      expect(
        await displayed.evaluate((element) => element.textContent?.length ?? 0),
      ).toBeLessThan(55 * 1024);
      const toggle = window.locator(".inspector-message button[aria-pressed]");
      const digest = () =>
        displayed.evaluate(async (element) => {
          const bytes = new TextEncoder().encode(element.textContent ?? "");
          const hash = await crypto.subtle.digest("SHA-256", bytes);
          return Array.from(new Uint8Array(hash), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join("");
        });
      await toggle.click();
      await expect.poll(digest, { timeout: 30_000 }).toBe(expectedHash);
      await toggle.click();
      await expect
        .poll(() =>
          displayed.evaluate((element) => element.textContent?.length ?? 0),
        )
        .toBeLessThan(55 * 1024);
      await toggle.click();
      await expect.poll(digest, { timeout: 30_000 }).toBe(expectedHash);
      expect(socketErrors).toEqual([]);

      if (source === "tcp") {
        const saved: { message: string; raw: typeof record } = JSON.parse(
          await readFile(automaticLogPath, "utf8"),
        );
        expect(saved.message).toBe(message);
        expect(saved.raw).toEqual(record);
        socket!.write(
          JSON.stringify({ ...record, message: "next record" }) + "\n",
        );
        await expect(window.locator("#countTotal")).toHaveText("2");
        const rotated: { message: string } = JSON.parse(
          await readFile(`${automaticLogPath}.1`, "utf8"),
        );
        expect(rotated.message).toBe(message);
        const next: { message: string } = JSON.parse(
          await readFile(automaticLogPath, "utf8"),
        );
        expect(next.message).toBe("next record");
      }

      await window
        .getByRole("button", { name: /^(Clear Logs|Logs leeren)$/ })
        .click();
      await window.getByRole("button", { name: "OK", exact: true }).click();
      await expect(window.locator("#countTotal")).toHaveText("0");
      await expect
        .poll(() =>
          window.evaluate(
            async (reference) =>
              (await globalThis.window.api.entryPayloadLoad(reference)).ok,
            stored.reference,
          ),
        )
        .toBe(false);
    } finally {
      socket?.destroy();
      if (source === "tcp")
        await window.evaluate(() => globalThis.window.api.tcpStop());
    }
  });
}
