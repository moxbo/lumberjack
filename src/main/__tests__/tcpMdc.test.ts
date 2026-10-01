import { afterEach, describe, expect, it, vi } from "vitest";
import { connect } from "net";
import { once } from "events";
import { NetworkService } from "../../services/NetworkService";
import { LoggingStore } from "../../store/loggingStore";
import { MDCListener } from "../../store/mdcListener";
import { matchesDcFilter } from "../../utils/dcMatch";
import { parseJsonFile, parseTextLines, toEntry } from "../parsers";
import { prepareRenderBatch } from "../util/logEntryUtils";
import type { LogEntry } from "../../types/ipc";

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

afterEach(() => LoggingStore.reset());

describe("TCP diagnostic context", () => {
  it("preserves fields across parsing, raw removal, renderer events and filtering", async () => {
    const service = new NetworkService();
    service.setParsers({ parseJsonFile, parseTextLines, toEntry });
    MDCListener.startListening();
    LoggingStore.reset();
    const received: LogEntry[] = [];
    service.setLogCallback((entries) => {
      const transferred = prepareRenderBatch(entries);
      LoggingStore.addEvents(transferred);
      received.push(...transferred);
    });
    const status = await service.startTcpServer(0);
    const socket = connect({ port: status.port!, host: "127.0.0.1" });
    socket.resume();
    try {
      await once(socket, "connect");
      socket.write(
        JSON.stringify({
          message: "message",
          application_name: "orders",
          attempt: 3,
          successful: false,
          mdc: { tenant: "tenant-1", trace_id: "trace-1" },
        }) + "\n",
      );
      await vi.waitFor(() => expect(received).toHaveLength(1));
      const entry = received[0]!;
      expect(entry).not.toHaveProperty("raw");
      expect(entry.mdc).toEqual({
        application_name: "orders",
        attempt: "3",
        successful: "false",
        tenant: "tenant-1",
        TraceID: "trace-1",
      });
      expect(MDCListener.getSortedKeys()).toEqual(
        ["application_name", "attempt", "successful", "tenant", "TraceID"].sort(
          (a, b) => a.localeCompare(b),
        ),
      );
      expect(MDCListener.getSortedValues("tenant")).toEqual(["tenant-1"]);
      expect(
        matchesDcFilter(entry.mdc, [
          { key: "tenant", value: "tenant-1", active: true },
          { key: "attempt", value: "3", active: true },
          { key: "traceId", value: "trace-1", active: true },
        ]),
      ).toBe(true);
    } finally {
      socket.destroy();
      await service.stopTcpServer();
    }
  });

  it("derives MDC before stripping raw from externally normalized entries", () => {
    const [entry] = prepareRenderBatch([
      {
        timestamp: null,
        message: "message",
        source: "tcp:test",
        raw: { requestId: "request-1", context: { tenant: "tenant-1" } },
      },
    ]);
    expect(entry).not.toHaveProperty("raw");
    expect(entry!.mdc).toEqual({ requestId: "request-1", tenant: "tenant-1" });
  });
});
