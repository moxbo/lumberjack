import { createServer } from "node:http";
import { test, expect } from "./electron-fixtures";

declare global {
  interface Window {
    backgroundPublicationTest: {
      visible: boolean | undefined;
      progress: number;
    };
  }
}

test("persists hidden HTTP-tail data without publishing rows until the native window returns", async ({
  electronApp,
  window,
}) => {
  await expect(window.locator("#splash-screen")).toHaveCount(0);
  await window.evaluate(() => {
    globalThis.window.backgroundPublicationTest = {
      visible: undefined,
      progress: 0,
    };
    globalThis.window.api.onWindowVisibilityChange((visible) => {
      globalThis.window.backgroundPublicationTest.visible = visible;
    });
    globalThis.window.api.onHttpTailStatus((payload) => {
      if (payload.type === "progress")
        globalThis.window.backgroundPublicationTest.progress =
          payload.offset ?? 0;
    });
  });
  await window.clock.install();
  await window.clock.pauseAt(new Date());
  const body =
    [1, 2]
      .map((index) =>
        JSON.stringify({
          timestamp: new Date(1_700_000_000_000 + index).toISOString(),
          level: "INFO",
          message: `hidden-tail-${index}`,
        }),
      )
      .join("\n") + "\n";
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/x-ndjson" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test HTTP port");
  try {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.hide(),
    );
    await expect
      .poll(() =>
        window.evaluate(
          () => globalThis.window.backgroundPublicationTest.visible,
        ),
      )
      .toBe(false);
    expect(await window.evaluate(() => document.hidden)).toBe(false);
    expect(
      (
        await window.evaluate(
          (url) =>
            globalThis.window.api.httpTailStart({
              url,
              emitInitial: true,
              intervalMs: 250,
            }),
          `http://127.0.0.1:${address.port}/logs`,
        )
      ).ok,
    ).toBe(true);
    // Progress is emitted after the tail sink's persistence acknowledgement.
    await expect
      .poll(() =>
        window.evaluate(
          () => globalThis.window.backgroundPublicationTest.progress,
        ),
      )
      .toBe(Buffer.byteLength(body));
    await expect(window.locator("#countTotal")).toHaveText("0");
    await expect
      .poll(() =>
        window.evaluate(
          async () =>
            (await globalThis.window.api.httpTailList()).tails[0]?.transferMode,
        ),
      )
      .toBe("full");
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.show(),
    );
    await expect
      .poll(() =>
        window.evaluate(
          () => globalThis.window.backgroundPublicationTest.visible,
        ),
      )
      .toBe(true);
    await window.clock.runFor(250);
    await expect(window.locator("#countTotal")).toHaveText("2");
    await expect(
      window
        .locator(".status-warning")
        .filter({ hasText: /Vollabruf|Full download/ }),
    ).toHaveCount(1);
  } finally {
    try {
      await window.evaluate(async () => {
        for (const tail of (await globalThis.window.api.httpTailList()).tails)
          await globalThis.window.api.httpTailStop(tail.id);
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
