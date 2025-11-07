#!/usr/bin/env tsx
/**
 * Memory and Resource Diagnostics Script
 *
 * This script analyzes logs, crash dumps, and system state to diagnose
 * memory and resource-related issues in Lumberjack.
 *
 * Usage:
 *   npm run diagnose:memory
 *   or
 *   tsx scripts/diagnose-memory.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ANSI color codes for better output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

interface DiagnosticResult {
  category: string;
  status: "OK" | "WARNING" | "ERROR" | "INFO";
  message: string;
  details?: string[];
}

const results: DiagnosticResult[] = [];

function addResult(
  category: string,
  status: DiagnosticResult["status"],
  message: string,
  details?: string[],
): void {
  results.push({ category, status, message, details });
}

function getLogPath(): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === "win32") {
    return path.join(
      process.env.APPDATA || "",
      "Lumberjack",
      "logs",
      "main.log",
    );
  } else if (platform === "darwin") {
    return path.join(home, "Library", "Logs", "Lumberjack", "main.log");
  } else {
    return path.join(home, ".local", "share", "Lumberjack", "logs", "main.log");
  }
}

function getCrashDumpPath(): string {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || "", "Lumberjack", "crashes");
  } else if (platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "Lumberjack",
      "crashes",
    );
  } else {
    return path.join(home, ".local", "share", "Lumberjack", "crashes");
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function checkSystemResources(): void {
  console.log(
    `\n${colors.bold}${colors.cyan}=== System Resources ===${colors.reset}\n`,
  );

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const usedPercent = (usedMem / totalMem) * 100;

  addResult(
    "System Memory",
    usedPercent > 90 ? "WARNING" : "OK",
    `${formatBytes(usedMem)} used of ${formatBytes(totalMem)} (${usedPercent.toFixed(1)}%)`,
    [`Free: ${formatBytes(freeMem)}`, `Used: ${formatBytes(usedMem)}`],
  );

  if (usedPercent > 90) {
    addResult(
      "System Memory",
      "WARNING",
      "System memory usage is very high (>90%)",
      [
        "This may cause the application to be slow or crash",
        "Consider closing other applications",
        "If Lumberjack uses a lot of memory, see TROUBLESHOOTING_MEMORY.md",
      ],
    );
  }

  const cpus = os.cpus();
  addResult(
    "CPU",
    "INFO",
    `${cpus.length} CPU(s): ${cpus[0]?.model || "Unknown"}`,
    [`Platform: ${os.platform()}`, `Architecture: ${os.arch()}`],
  );
}

function checkLogFiles(): void {
  console.log(
    `\n${colors.bold}${colors.cyan}=== Log File Analysis ===${colors.reset}\n`,
  );

  const logPath = getLogPath();
  console.log(`Log path: ${logPath}`);

  if (!fs.existsSync(logPath)) {
    addResult("Log File", "WARNING", "Log file not found", [
      `Expected at: ${logPath}`,
      "This may indicate the application has never been started",
      "Or log directory permissions issue",
    ]);
    return;
  }

  const stats = fs.statSync(logPath);
  const logSize = stats.size;

  addResult(
    "Log File",
    logSize > 100 * 1024 * 1024 ? "WARNING" : "OK",
    `Log file size: ${formatBytes(logSize)}`,
    [`Last modified: ${stats.mtime.toLocaleString()}`],
  );

  if (logSize > 100 * 1024 * 1024) {
    addResult("Log File", "WARNING", "Log file is very large (>100 MB)", [
      "Consider deleting old log files",
      "See TROUBLESHOOTING_MEMORY.md for instructions",
    ]);
  }

  // Analyze log content
  try {
    const logContent = fs.readFileSync(logPath, "utf-8");
    const lines = logContent.split("\n");
    const recentLines = lines.slice(-1000); // Last 1000 lines

    // Check for memory-related issues
    const memoryWarnings = recentLines.filter(
      (line) =>
        line.includes("Buffer overflow") ||
        line.includes("memory") ||
        line.includes("OOM") ||
        line.includes("heap"),
    );

    if (memoryWarnings.length > 0) {
      addResult(
        "Log Analysis",
        "WARNING",
        `Found ${memoryWarnings.length} memory-related log entries`,
        [
          "Sample entries:",
          ...memoryWarnings
            .slice(0, 3)
            .map((line) => `  ${line.substring(0, 100)}...`),
        ],
      );
    }

    // Check for TCP socket issues
    const tcpConnected = recentLines.filter((line) =>
      line.includes("[tcp] Socket connected"),
    ).length;
    const tcpCleaned = recentLines.filter((line) =>
      line.includes("[tcp] Socket cleaned up"),
    ).length;

    if (tcpConnected > 0) {
      const status = tcpConnected > tcpCleaned * 1.5 ? "WARNING" : "OK";
      addResult(
        "TCP Sockets",
        status,
        `${tcpConnected} connections, ${tcpCleaned} cleanups`,
        status === "WARNING"
          ? [
              "More connections than cleanups may indicate a socket leak",
              "Check if TCP clients are properly disconnecting",
            ]
          : undefined,
      );
    }

    // Check for HTTP poller trimming
    const httpTrimming = recentLines.filter((line) =>
      line.includes("Trimmed seen Set"),
    ).length;

    if (httpTrimming > 0) {
      addResult(
        "HTTP Polling",
        httpTrimming > 10 ? "WARNING" : "OK",
        `Deduplication Set trimmed ${httpTrimming} times`,
        httpTrimming > 10
          ? [
              "Frequent trimming indicates many unique log entries",
              "This is normal but may indicate high memory usage",
            ]
          : undefined,
      );
    }

    // Check for connection limit warnings
    const connectionLimitWarnings = recentLines.filter((line) =>
      line.includes("Connection limit"),
    ).length;

    if (connectionLimitWarnings > 0) {
      addResult(
        "Connection Limits",
        "WARNING",
        `${connectionLimitWarnings} connection limit warnings`,
        [
          "Application is approaching or at connection limit",
          "Consider reducing concurrent connections",
          "Default limit: 1000 connections",
        ],
      );
    }

    // Check for crashes/errors
    const errors = recentLines.filter(
      (line) =>
        line.toLowerCase().includes("error") ||
        line.toLowerCase().includes("fatal"),
    ).length;

    if (errors > 10) {
      addResult(
        "Errors",
        "WARNING",
        `Found ${errors} error log entries (last 1000 lines)`,
        [
          "Review logs for error details",
          "Multiple errors may indicate an underlying issue",
        ],
      );
    }

    // Check for signal handlers
    const signals = recentLines.filter(
      (line) =>
        line.includes("SIGTERM") ||
        line.includes("SIGINT") ||
        line.includes("SIGHUP"),
    );

    if (signals.length > 0) {
      addResult(
        "Process Signals",
        "INFO",
        `Found ${signals.length} signal events`,
        [
          "Application received OS termination signals",
          "Sample entries:",
          ...signals
            .slice(0, 2)
            .map((line) => `  ${line.substring(0, 100)}...`),
        ],
      );
    }

    // Check last log entry timestamp
    const lastLine = lines[lines.length - 1];
    if (lastLine) {
      const timestampMatch = lastLine.match(
        /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/,
      );
      if (timestampMatch) {
        const lastLogTime = new Date(timestampMatch[1]);
        const now = new Date();
        const minutesAgo = (now.getTime() - lastLogTime.getTime()) / 1000 / 60;

        addResult(
          "Last Log Entry",
          "INFO",
          `${minutesAgo.toFixed(0)} minutes ago`,
          [`Timestamp: ${lastLogTime.toLocaleString()}`],
        );
      }
    }
  } catch (error) {
    addResult("Log Analysis", "ERROR", "Failed to analyze log file", [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

function checkCrashDumps(): void {
  console.log(
    `\n${colors.bold}${colors.cyan}=== Crash Dumps ===${colors.reset}\n`,
  );

  const crashPath = getCrashDumpPath();
  console.log(`Crash dump path: ${crashPath}`);

  if (!fs.existsSync(crashPath)) {
    addResult("Crash Dumps", "OK", "No crash dump directory found", [
      "This is normal if no crashes have occurred",
    ]);
    return;
  }

  try {
    const files = fs.readdirSync(crashPath);
    const dumpFiles = files.filter(
      (f) => f.endsWith(".dmp") || f.includes("crash"),
    );

    if (dumpFiles.length === 0) {
      addResult("Crash Dumps", "OK", "No crash dumps found", [
        "Application has not crashed with native errors",
      ]);
    } else {
      addResult(
        "Crash Dumps",
        "WARNING",
        `Found ${dumpFiles.length} crash dump(s)`,
        [
          "Application has experienced native crashes",
          "Crash dumps:",
          ...dumpFiles.slice(0, 5).map((f) => {
            const stat = fs.statSync(path.join(crashPath, f));
            return `  ${f} (${formatBytes(stat.size)}, ${stat.mtime.toLocaleDateString()})`;
          }),
          dumpFiles.length > 5 ? `  ... and ${dumpFiles.length - 5} more` : "",
        ],
      );
    }
  } catch (error) {
    addResult("Crash Dumps", "ERROR", "Failed to check crash dumps", [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

function checkApplicationData(): void {
  console.log(
    `\n${colors.bold}${colors.cyan}=== Application Data ===${colors.reset}\n`,
  );

  const platform = process.platform;
  const home = os.homedir();
  let appDataPath: string;

  if (platform === "win32") {
    appDataPath = path.join(process.env.APPDATA || "", "Lumberjack");
  } else if (platform === "darwin") {
    appDataPath = path.join(
      home,
      "Library",
      "Application Support",
      "Lumberjack",
    );
  } else {
    appDataPath = path.join(home, ".local", "share", "Lumberjack");
  }

  console.log(`Application data path: ${appDataPath}`);

  if (!fs.existsSync(appDataPath)) {
    addResult(
      "Application Data",
      "INFO",
      "No application data directory found",
      ["Application may not have been run yet"],
    );
    return;
  }

  // Calculate total size of application data
  function getDirSize(dirPath: string): number {
    let totalSize = 0;
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          totalSize += getDirSize(filePath);
        } else {
          totalSize += stat.size;
        }
      }
    } catch (error) {
      // Ignore errors
    }
    return totalSize;
  }

  const totalSize = getDirSize(appDataPath);

  addResult(
    "Application Data",
    totalSize > 500 * 1024 * 1024 ? "WARNING" : "OK",
    `Total size: ${formatBytes(totalSize)}`,
    totalSize > 500 * 1024 * 1024
      ? [
          "Application data is quite large",
          "May include large cache or log files",
          "Consider cleaning up old data",
        ]
      : undefined,
  );

  // Check for large subdirectories
  try {
    const subdirs = fs.readdirSync(appDataPath).filter((f) => {
      const fullPath = path.join(appDataPath, f);
      return fs.statSync(fullPath).isDirectory();
    });

    for (const subdir of subdirs) {
      const subdirPath = path.join(appDataPath, subdir);
      const subdirSize = getDirSize(subdirPath);
      if (subdirSize > 100 * 1024 * 1024) {
        addResult(
          "Application Data",
          "INFO",
          `${subdir}: ${formatBytes(subdirSize)}`,
          [`Large subdirectory found`],
        );
      }
    }
  } catch (error) {
    // Ignore
  }
}

function printResults(): void {
  console.log(
    `\n${colors.bold}${colors.cyan}=== Diagnostic Results ===${colors.reset}\n`,
  );

  const statusColors = {
    OK: colors.green,
    WARNING: colors.yellow,
    ERROR: colors.red,
    INFO: colors.blue,
  };

  const statusSymbols = {
    OK: "✓",
    WARNING: "⚠",
    ERROR: "✗",
    INFO: "ℹ",
  };

  for (const result of results) {
    const color = statusColors[result.status];
    const symbol = statusSymbols[result.status];

    console.log(
      `${color}${symbol} [${result.category}]${colors.reset} ${result.message}`,
    );

    if (result.details && result.details.length > 0) {
      for (const detail of result.details) {
        if (detail.trim()) {
          console.log(`  ${detail}`);
        }
      }
    }
    console.log();
  }
}

function printSummary(): void {
  console.log(`\n${colors.bold}${colors.cyan}=== Summary ===${colors.reset}\n`);

  const okCount = results.filter((r) => r.status === "OK").length;
  const warningCount = results.filter((r) => r.status === "WARNING").length;
  const errorCount = results.filter((r) => r.status === "ERROR").length;
  const infoCount = results.filter((r) => r.status === "INFO").length;

  console.log(`${colors.green}✓ OK:${colors.reset}      ${okCount}`);
  console.log(`${colors.yellow}⚠ Warnings:${colors.reset} ${warningCount}`);
  console.log(`${colors.red}✗ Errors:${colors.reset}   ${errorCount}`);
  console.log(`${colors.blue}ℹ Info:${colors.reset}     ${infoCount}`);

  console.log();

  if (errorCount > 0) {
    console.log(
      `${colors.red}${colors.bold}Action Required:${colors.reset} ${errorCount} error(s) detected.`,
    );
    console.log(`Review the errors above and take corrective action.`);
    console.log();
  } else if (warningCount > 0) {
    console.log(
      `${colors.yellow}${colors.bold}Attention:${colors.reset} ${warningCount} warning(s) detected.`,
    );
    console.log(
      `Review the warnings above. These may indicate potential issues.`,
    );
    console.log();
  } else {
    console.log(
      `${colors.green}${colors.bold}All checks passed!${colors.reset} No issues detected.`,
    );
    console.log();
  }

  console.log(`${colors.bold}Next Steps:${colors.reset}`);
  console.log(`1. Review warnings and errors above`);
  console.log(
    `2. Consult docs/TROUBLESHOOTING_MEMORY.md for detailed guidance`,
  );
  console.log(`3. If issues persist, collect logs and system info for support`);
  console.log(
    `4. Check GitHub issues: https://github.com/moxbo/lumberjack/issues`,
  );
  console.log();
}

function printRecommendations(): void {
  const hasWarnings = results.some(
    (r) => r.status === "WARNING" || r.status === "ERROR",
  );

  if (!hasWarnings) {
    return;
  }

  console.log(
    `\n${colors.bold}${colors.cyan}=== Recommendations ===${colors.reset}\n`,
  );

  // Memory warnings
  const memoryIssues = results.filter(
    (r) =>
      (r.status === "WARNING" || r.status === "ERROR") &&
      (r.category.includes("Memory") ||
        r.message.toLowerCase().includes("memory")),
  );

  if (memoryIssues.length > 0) {
    console.log(`${colors.yellow}Memory Issues Detected:${colors.reset}`);
    console.log(`• Close other applications to free up RAM`);
    console.log(`• Restart Lumberjack to clear accumulated memory`);
    console.log(`• Handle large log files in smaller chunks`);
    console.log(`• Monitor memory usage over time`);
    console.log();
  }

  // TCP issues
  const tcpIssues = results.filter(
    (r) =>
      (r.status === "WARNING" || r.status === "ERROR") &&
      r.category.includes("TCP"),
  );

  if (tcpIssues.length > 0) {
    console.log(
      `${colors.yellow}TCP Connection Issues Detected:${colors.reset}`,
    );
    console.log(`• Ensure TCP clients are properly disconnecting`);
    console.log(`• Check for client-side connection leaks`);
    console.log(`• Review TCP server logs for cleanup messages`);
    console.log(`• Consider reducing concurrent connections`);
    console.log();
  }

  // HTTP issues
  const httpIssues = results.filter(
    (r) =>
      (r.status === "WARNING" || r.status === "ERROR") &&
      r.category.includes("HTTP"),
  );

  if (httpIssues.length > 0) {
    console.log(`${colors.yellow}HTTP Polling Issues Detected:${colors.reset}`);
    console.log(`• Frequent trimming is normal with many unique entries`);
    console.log(`• Consider increasing polling interval`);
    console.log(`• Monitor memory usage during polling`);
    console.log(`• Check HTTP endpoints for response size`);
    console.log();
  }

  // Log file size
  const logIssues = results.filter(
    (r) =>
      (r.status === "WARNING" || r.status === "ERROR") &&
      r.category.includes("Log"),
  );

  if (logIssues.length > 0) {
    console.log(`${colors.yellow}Log File Issues Detected:${colors.reset}`);
    console.log(`• Delete old log files to free disk space`);
    console.log(`• Archive logs if needed for future reference`);
    console.log(`• Check log rotation settings`);
    console.log();
  }

  // Crash dumps
  const crashIssues = results.filter(
    (r) =>
      (r.status === "WARNING" || r.status === "ERROR") &&
      r.category.includes("Crash"),
  );

  if (crashIssues.length > 0) {
    console.log(`${colors.yellow}Crash Dumps Found:${colors.reset}`);
    console.log(`• Application has experienced native crashes`);
    console.log(`• Preserve crash dumps for debugging`);
    console.log(`• Report crashes to developers with dumps`);
    console.log(`• Check for GPU/graphics driver issues`);
    console.log(`• Ensure native dependencies are compatible`);
    console.log();
  }
}

// Main execution
console.log(
  `${colors.bold}${colors.cyan}Lumberjack Memory & Resource Diagnostics${colors.reset}`,
);
console.log(
  `${colors.cyan}==========================================${colors.reset}\n`,
);

checkSystemResources();
checkLogFiles();
checkCrashDumps();
checkApplicationData();
printResults();
printSummary();
printRecommendations();

console.log(
  `${colors.cyan}===========================================${colors.reset}`,
);
console.log(`${colors.bold}Diagnostics complete!${colors.reset}\n`);

// Exit with appropriate code
const hasErrors = results.some((r) => r.status === "ERROR");
const hasWarnings = results.some((r) => r.status === "WARNING");

if (hasErrors) {
  process.exit(1);
} else if (hasWarnings) {
  process.exit(0); // Warnings are not fatal
} else {
  process.exit(0);
}
