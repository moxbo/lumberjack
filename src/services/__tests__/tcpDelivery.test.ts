import { describe, expect, it, vi } from "vitest";
import { connect } from "net";
import { once } from "events";
import { NetworkService } from "../NetworkService";
import { WindowAppendQueue } from "../WindowAppendQueue";
import type { LogEntry } from "../../types/ipc";

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("TCP renderer delivery", () => {
  it("continues receiving across asynchronous ACK boundaries without another socket write", async () => {
    const service = new NetworkService();
    const queue = new WindowAppendQueue<LogEntry>();
    const received: string[] = [];
    service.setParsers({
      parseJsonFile: () => [],
      parseTextLines: () => [],
      toEntry: (object, _fallback, source) => ({
        timestamp: null,
        message: String(object.message),
        source,
      }),
    });
    const flushIfIdle = () => {
      if (queue.isFlushing) return;
      void queue
        .flush(
          async (blocks) => {
            await Promise.resolve();
            received.push(
              ...[...blocks.batches(100)].flat().map((entry) => entry.message),
            );
          },
          () => 0,
          false,
        )
        .catch(() => {});
    };
    service.setLogCallback(async (entries) => {
      for (const entry of entries) {
        const receipt = queue.enqueue([entry]);
        flushIfIdle();
        await receipt;
        await Promise.resolve();
      }
    });
    const status = await service.startTcpServer(0);
    const socket = connect({ port: status.port!, host: "127.0.0.1" });
    socket.resume();
    try {
      await once(socket, "connect");
      const expected = Array.from({ length: 1501 }, (_, index) =>
        String(index),
      );
      socket.write(
        expected.map((message) => JSON.stringify({ message }) + "\n").join(""),
      );
      await vi.waitFor(() => expect(received).toHaveLength(expected.length));
      expect(received).toEqual(expected);
      expect(service.getTcpStatus().activeConnections).toBe(1);
      expect(queue.length).toBe(0);
    } finally {
      queue.dispose();
      socket.destroy();
      await service.stopTcpServer();
    }
  });
});
