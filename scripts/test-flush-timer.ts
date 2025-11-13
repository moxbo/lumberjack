#!/usr/bin/env tsx
/**
 * Test script to verify the flush timer fix
 * Sends TCP log entries and monitors if they appear in the app
 */

import * as net from "net";
import * as readline from "readline";

const DEFAULT_PORT = 5000;
const DEFAULT_HOST = "localhost";

interface LogEntry {
  timestamp: string;
  level: string;
  logger?: string;
  thread?: string;
  message: string;
  source?: string;
}

function createTestEntry(
  index: number,
  level: "INFO" | "ERROR" | "WARN" | "DEBUG" = "INFO",
): LogEntry {
  const timestamp = new Date().toISOString();
  return {
    timestamp,
    level,
    logger: "test.logger",
    thread: "test-thread-1",
    message: `Test entry #${index}: ${new Date().toLocaleTimeString()}`,
    source: "tcp://test",
  };
}

function sendEntry(socket: net.Socket, entry: LogEntry): void {
  const line = JSON.stringify(entry) + "\n";
  socket.write(line, (err) => {
    if (err) {
      console.error("[ERROR] Failed to send entry:", err.message);
    } else {
      console.log(
        `[SENT] Entry #${entry.message.match(/#(\d+)/)?.[1]} (${entry.level})`,
      );
    }
  });
}

async function runInteractiveMode(
  host: string,
  port: number,
): Promise<void> {
  const socket = net.createConnection({ host, port });

  socket.on("connect", () => {
    console.log(`\n✓ Connected to ${host}:${port}`);
    console.log("Commands:");
    console.log("  send N         - Send N test entries");
    console.log("  burst N        - Send N entries rapidly (tests batching)");
    console.log("  level LEVEL    - Set level (INFO|WARN|ERROR|DEBUG)");
    console.log("  exit           - Disconnect and exit\n");
  });

  socket.on("error", (err) => {
    console.error(`[ERROR] Connection failed: ${err.message}`);
    console.error(`Make sure Lumberjack has TCP server running on ${host}:${port}`);
    process.exit(1);
  });

  socket.on("close", () => {
    console.log("\n✓ Disconnected");
    process.exit(0);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let currentLevel: "INFO" | "ERROR" | "WARN" | "DEBUG" = "INFO";
  let entryCount = 0;

  const prompt = () => {
    rl.question("> ", (input) => {
      try {
        const [cmd, ...args] = input.trim().split(" ");
        const arg = args[0];

        switch (cmd.toLowerCase()) {
          case "send": {
            const count = parseInt(arg || "1", 10) || 1;
            console.log(`Sending ${count} entries with level ${currentLevel}...`);
            for (let i = 0; i < count; i++) {
              entryCount++;
              const entry = createTestEntry(entryCount, currentLevel);
              // Small delay between entries to avoid overwhelming
              setTimeout(
                () => sendEntry(socket, entry),
                i * 10, // 10ms between entries
              );
            }
            break;
          }

          case "burst": {
            const count = parseInt(arg || "10", 10) || 10;
            console.log(
              `Sending ${count} entries RAPIDLY (tests batching)...`,
            );
            for (let i = 0; i < count; i++) {
              entryCount++;
              const entry = createTestEntry(entryCount, currentLevel);
              // Send immediately without delay
              sendEntry(socket, entry);
            }
            break;
          }

          case "level": {
            const level = (arg || "INFO").toUpperCase() as
              | "INFO"
              | "ERROR"
              | "WARN"
              | "DEBUG";
            if (["INFO", "ERROR", "WARN", "DEBUG"].includes(level)) {
              currentLevel = level;
              console.log(`Level set to ${currentLevel}`);
            } else {
              console.log(`Invalid level. Use: INFO, WARN, ERROR, or DEBUG`);
            }
            break;
          }

          case "exit": {
            socket.end();
            rl.close();
            return;
          }

          default:
            if (input.trim()) {
              console.log(`Unknown command: ${cmd}`);
            }
        }
      } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : String(err));
      }

      prompt();
    });
  };

  prompt();
}

async function runBatchMode(
  host: string,
  port: number,
  count: number,
): Promise<void> {
  const socket = net.createConnection({ host, port });

  socket.on("connect", () => {
    console.log(`✓ Connected to ${host}:${port}`);
    console.log(`Sending ${count} test entries...`);

    for (let i = 1; i <= count; i++) {
      const entry = createTestEntry(i);
      sendEntry(socket, entry);
    }

    // Give time for last sends to complete
    setTimeout(() => {
      console.log(`\n✓ Sent ${count} entries`);
      console.log(
        "Check Lumberjack UI - entries should appear in the list with 100ms flush delay",
      );
      socket.end();
    }, 1000);
  });

  socket.on("error", (err) => {
    console.error(`[ERROR] Connection failed: ${err.message}`);
    console.error(`Make sure Lumberjack has TCP server running on ${host}:${port}`);
    process.exit(1);
  });

  socket.on("close", () => {
    process.exit(0);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const host = args[0] || DEFAULT_HOST;
  const port = parseInt(args[1] || String(DEFAULT_PORT), 10) || DEFAULT_PORT;
  const count = parseInt(args[2] || "0", 10) || 0;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Lumberjack TCP Flush Timer Test                        ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`\nTarget: ${host}:${port}`);

  if (count > 0) {
    await runBatchMode(host, port, count);
  } else {
    await runInteractiveMode(host, port);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

