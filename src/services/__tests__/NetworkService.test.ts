import { afterEach, describe, expect, it, vi } from "vitest";
import { once } from "events";
import { connect } from "net";
import { NetworkService } from "../NetworkService";

vi.mock("electron-log/main", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(() => vi.restoreAllMocks());

describe("TCP shutdown", () => {
  it.each([false, true])(
    "bounds shutdown and flushes trailing lines with allowHalfOpen=%s",
    async (allowHalfOpen) => {
      const service = new NetworkService();
      let parsed!: () => void;
      const receivedFirstLine = new Promise<void>((resolve) => {
        parsed = resolve;
      });
      const messages: string[] = [];
      service.setParsers({
        parseJsonFile: () => [],
        parseTextLines: () => [],
        toEntry: (entry, _fallback, source) => {
          parsed();
          return { timestamp: null, message: String(entry.message), source };
        },
      });
      service.setLogCallback((entries) => {
        messages.push(...entries.map((entry) => entry.message));
      });
      const status = await service.startTcpServer(0);
      expect(status.ok).toBe(true);
      const socket = connect({
        port: status.port!,
        host: "127.0.0.1",
        allowHalfOpen,
      });
      socket.resume();
      try {
        await once(socket, "connect");
        socket.write("complete\ntrailing");
        await receivedFirstLine;
        const schedule = vi.spyOn(globalThis, "setTimeout");
        const clear = vi.spyOn(globalThis, "clearTimeout");
        const started = performance.now();
        const stop = service.stopTcpServer();
        expect(service.stopTcpServer()).toBe(stop);
        const timerCall = schedule.mock.calls.findIndex(
          (args) => args[1] === 1000,
        );
        expect(timerCall).toBeGreaterThanOrEqual(0);
        const timer = schedule.mock.results[timerCall]!.value as NodeJS.Timeout;
        expect(timer.hasRef()).toBe(false);
        await expect(stop).resolves.toMatchObject({ ok: true, running: false });
        expect(performance.now() - started).toBeLessThan(2500);
        expect(clear).toHaveBeenCalledWith(timer);
        expect(service.getTcpStatus()).toMatchObject({
          running: false,
          activeConnections: 0,
        });
        // The stop promise must include socket cleanup, not just server.close.
        expect(messages).toEqual(["complete", "trailing"]);
        if (allowHalfOpen) expect(socket.writableEnded).toBe(false);
      } finally {
        socket.destroy();
        await service.stopTcpServer();
      }
    },
    4000,
  );
});
