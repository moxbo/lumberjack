import * as net from "net";
import { NetworkService } from "../src/services/NetworkService";
import type { LogEntry } from "../src/types/ipc";

async function main(): Promise<void> {
  const ns = new NetworkService();
  const received: LogEntry[] = [];
  ns.setLogCallback((e) => received.push(...e));
  ns.setParsers({
    parseJsonFile: () => [],
    parseTextLines: () => [],
    toEntry: (obj, _f, source) => ({
      timestamp: new Date().toISOString(),
      level: (obj.level as string) || "INFO",
      logger: null,
      thread: null,
      message: (obj.message as string) || "",
      traceId: null,
      stackTrace: null,
      raw: obj,
      source,
    }),
  });

  const status = await ns.startTcpServer(0);
  const port = status.port!;
  const sock = net.connect(port, "127.0.0.1");
  await new Promise((r) => sock.on("connect", r));

  // Send ONE message WITHOUT trailing newline, then close.
  sock.write(JSON.stringify({ level: "INFO", message: "no-newline-msg" }));
  await new Promise((r) => setTimeout(r, 50));
  console.warn("After write (no newline), received:", received.length);
  sock.end();
  await new Promise((r) => setTimeout(r, 100));
  console.warn("After close, received:", received.length);
  console.warn(
    "Messages:",
    received.map((r) => r.message),
  );

  await ns.stopTcpServer();
  const first = received[0];
  if (received.length === 1 && first?.message === "no-newline-msg") {
    console.warn("✅ PASS: trailing entry without newline is now displayed");
    process.exit(0);
  } else {
    console.warn("❌ FAIL");
    process.exit(1);
  }
}

void main();
