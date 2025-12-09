#!/usr/bin/env tsx
/**
 * Exit Code 1 Diagnostic Script
 *
 * This script analyzes electron-log files to identify the root cause
 * of exit code 1 issues in the Lumberjack application.
 *
 * Usage:
 *   tsx scripts/analyze-exit-logs.ts [path-to-log-file]
 *
 * If no path is provided, it will look in the default electron-log location.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: any;
}

interface ExitEvent {
  timestamp: string;
  type: string;
  exitCode?: number;
  source?: string;
  details?: any;
}

function getDefaultLogPath(): string {
  const platform = process.platform;
  const appName = "Lumberjack";

  if (platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      appName,
      "logs",
      "main.log",
    );
  } else if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Logs", appName, "main.log");
  } else {
    // Linux
    return path.join(
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
      appName,
      "logs",
      "main.log",
    );
  }
}

function parseLogLine(line: string): LogEntry | null {
  try {
    // electron-log format: [YYYY-MM-DD HH:mm:ss.SSS] [level] message
    const match = line.match(/^\[([\d-]+ [\d:.]+)\] \[(\w+)\] (.+)$/);
    if (!match) return null;

    const [, timestamp, level, message] = match;
    if (!timestamp || !level || !message) return null;
    return { timestamp, level, message };
  } catch {
    return null;
  }
}

function analyzeLogFile(logPath: string): void {
  console.log(`\n=== Analyzing log file: ${logPath} ===\n`);

  if (!fs.existsSync(logPath)) {
    console.error(`ERROR: Log file not found: ${logPath}`);
    console.log("\nTry running the app first to generate logs.");
    return;
  }

  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.split("\n");

  const exitEvents: ExitEvent[] = [];
  const errors: LogEntry[] = [];
  const warnings: LogEntry[] = [];
  const diagnostics: LogEntry[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const entry = parseLogLine(line);
    if (!entry) continue;

    // Collect exit-related events
    if (entry.message.includes("[diag] process exit")) {
      const codeMatch = entry.message.match(/code[:\s]+(\d+)/i);
      exitEvents.push({
        timestamp: entry.timestamp,
        type: "exit",
        exitCode: codeMatch?.[1] ? parseInt(codeMatch[1], 10) : undefined,
      });
    } else if (entry.message.includes("[diag] beforeExit")) {
      const codeMatch = entry.message.match(/code[:\s]+(\d+)/i);
      const sourceMatch = entry.message.match(/source[:\s]+(\w+)/i);
      exitEvents.push({
        timestamp: entry.timestamp,
        type: "beforeExit",
        exitCode: codeMatch?.[1] ? parseInt(codeMatch[1], 10) : undefined,
        source: sourceMatch?.[1],
      });
    } else if (entry.message.includes("[diag] uncaughtException")) {
      exitEvents.push({
        timestamp: entry.timestamp,
        type: "uncaughtException",
        details: entry.message,
      });
    } else if (entry.message.includes("[diag] unhandledRejection")) {
      exitEvents.push({
        timestamp: entry.timestamp,
        type: "unhandledRejection",
        details: entry.message,
      });
    } else if (entry.message.includes("[diag] render-process-gone")) {
      exitEvents.push({
        timestamp: entry.timestamp,
        type: "render-process-gone",
        details: entry.message,
      });
    } else if (entry.message.includes("[diag] child-process-gone")) {
      exitEvents.push({
        timestamp: entry.timestamp,
        type: "child-process-gone",
        details: entry.message,
      });
    }

    // Collect errors and warnings
    if (entry.level === "error") {
      errors.push(entry);
    } else if (entry.level === "warn") {
      warnings.push(entry);
    }

    // Collect all diagnostic messages
    if (entry.message.includes("[diag]")) {
      diagnostics.push(entry);
    }
  }

  // Report findings
  console.log("=== Summary ===");
  console.log(`Total log lines: ${lines.filter((l) => l.trim()).length}`);
  console.log(`Exit events: ${exitEvents.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Diagnostic messages: ${diagnostics.length}`);

  // Check for exit code 1 events
  const exitCode1Events = exitEvents.filter((e) => e.exitCode === 1);

  if (exitEvents.length > 0) {
    console.log("\n=== Exit Events ===");
    exitEvents.forEach((event, idx) => {
      console.log(`\n${idx + 1}. ${event.type} at ${event.timestamp}`);
      if (event.exitCode !== undefined) {
        console.log(`   Exit Code: ${event.exitCode}`);
      }
      if (event.source) {
        console.log(`   Source: ${event.source}`);
      }
      if (event.details) {
        const detailsStr =
          typeof event.details === "string"
            ? event.details
            : JSON.stringify(event.details);
        const preview =
          detailsStr.length > 200
            ? `${detailsStr.substring(0, 200)}...`
            : detailsStr;
        console.log(`   Details: ${preview}`);
      }
    });

    if (exitCode1Events.length > 0) {
      console.log("\n⚠️  EXIT CODE 1 DETECTED! ⚠️");
      console.log(
        `Found ${exitCode1Events.length} occurrence(s) of exit code 1`,
      );
    }
  }

  // Show recent errors before exit
  if (errors.length > 0) {
    console.log("\n=== Recent Errors (last 10) ===");
    errors.slice(-10).forEach((error, idx) => {
      console.log(
        `\n${idx + 1}. [${error.timestamp}] ${error.message.substring(0, 200)}`,
      );
    });
  }

  // Show exit-related diagnostics
  const exitDiagnostics = diagnostics.filter(
    (d) =>
      d.message.includes("exit") ||
      d.message.includes("quit") ||
      d.message.includes("Exception") ||
      d.message.includes("Rejection") ||
      d.message.includes("gone") ||
      d.message.includes("crashed"),
  );

  if (exitDiagnostics.length > 0) {
    console.log("\n=== Exit-Related Diagnostics (last 20) ===");
    exitDiagnostics.slice(-20).forEach((d, idx) => {
      console.log(
        `${idx + 1}. [${d.timestamp}] ${d.message.substring(0, 150)}`,
      );
    });
  }

  console.log("\n=== Recommendations ===");
  if (exitCode1Events.length > 0) {
    console.log("1. Check the errors and exit events above for the root cause");
    console.log(
      "2. Look for 'uncaughtException' or 'unhandledRejection' events",
    );
    console.log(
      "3. Check 'render-process-gone' events which may indicate renderer crashes",
    );
  } else {
    console.log("✓ No exit code 1 events found in the log file");
  }

  if (errors.length > 10) {
    console.log(
      `4. Multiple errors detected (${errors.length}). Review full log for patterns`,
    );
  }

  console.log(
    "\nFor detailed analysis, open the full log file in a text editor:",
  );
  console.log(`  ${logPath}`);
  console.log("");
}

// Main execution
const args = process.argv.slice(2);
const logPath = args[0] || getDefaultLogPath();

analyzeLogFile(logPath);
