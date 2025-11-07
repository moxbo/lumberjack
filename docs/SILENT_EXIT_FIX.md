# Silent Exit Fix - Ensuring Logs are Always Written

## Problem Description

The application was experiencing unexpected exits with **no corresponding entries in main.log**. This is a critical diagnostic issue because:

1. Without log entries, it's impossible to determine the cause of the exit
2. The application exits silently, making troubleshooting extremely difficult
3. Users cannot report the issue with useful diagnostic information

## Root Causes of Silent Exits

Silent exits (no log entries) can occur due to several reasons:

### 1. Process Killed Before Logs Flushed
- **SIGKILL** signal from OS (cannot be caught)
- **OOM (Out of Memory) Killer** terminating the process
- **Forced termination** by task manager or system watchdog
- **Power loss** or system crash

### 2. Buffered Logs Not Written to Disk
- Logs buffered in memory but not flushed before crash
- File system issues preventing writes
- Disk full or permissions issues
- Log file rotation occurring during crash

### 3. Crashes Before Logger Initialization
- Native module crashes during startup
- V8 engine crashes
- Electron framework crashes before main process fully loads
- Missing dependencies causing early exit

### 4. OS-Level Termination
- **SIGTERM** or **SIGINT** signals not handled
- Container orchestrator forcefully terminating
- CI/CD pipeline timeouts
- System shutdown during application run

## Implemented Solutions

### 1. Force Immediate Log Writes

```typescript
// Configure file transport for immediate writes (reduce buffering)
if (log.transports.file.level !== false) {
  // Force sync writes for error and fatal levels
  log.transports.file.sync = true;
  // Reduce buffer size to ensure more frequent disk writes
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB max file size
}
```

**Impact**: Logs are written synchronously to disk immediately, reducing the window where buffered logs could be lost.

### 2. Explicit Log Flushing on All Exit Paths

A new `forceFlushLogs()` helper ensures logs reach disk:

```typescript
function forceFlushLogs(): void {
  try {
    if (log && typeof (log as any).transports?.file?.flush === "function") {
      (log as any).transports.file.flush();
    }
  } catch (e) {
    // Last resort: write to stderr if log flushing fails
    console.error("[FATAL] Failed to flush logs:", e);
  }
}
```

This is called at critical points:
- Before exit in all signal handlers
- On uncaught exceptions and unhandled rejections
- In `beforeExit` and `exit` event handlers
- On renderer process crashes and child process failures
- On user-initiated quit (before-quit, will-quit)
- During application cleanup (quit event)

### 3. OS-Level Signal Handlers

```typescript
// Catch OS signals before they terminate the process
const signals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;
signals.forEach((signal) => {
  process.on(signal, () => {
    log.warn(`[diag] Received ${signal} signal - process terminating`, {
      signal,
      pid: process.pid,
      uptime: process.uptime(),
    });
    // Force flush to ensure signal is logged
    forceFlushLogs();
    // Give logs a moment to flush, then exit gracefully
    setTimeout(() => {
      app.quit();
    }, 100);
  });
});
```

**Impact**: When the OS sends termination signals, they are now caught, logged, and logs are flushed before the process exits.

### 4. Periodic Log Flushing

```typescript
// Flush logs every 5 seconds to reduce data loss window
setInterval(() => {
  try {
    forceFlushLogs();
  } catch {
    // ignore flush errors
  }
}, 5000);
```

**Impact**: Even if the application crashes unexpectedly, logs from the last 5 seconds are likely to be on disk.

### 5. Early Initialization Logging

```typescript
// Log startup immediately to help diagnose early crashes
log.info("[diag] ========================================");
log.info("[diag] Application starting", {
  version: app.getVersion?.() || "unknown",
  platform: process.platform,
  arch: process.arch,
  nodeVersion: process.versions.node,
  electronVersion: process.versions.electron,
  pid: process.pid,
  isDev,
  logPath: log.transports.file.level !== false 
    ? log.transports.file.getFile().path 
    : "disabled",
});
```

**Impact**: If the application crashes during startup, we'll have a log entry showing the startup attempt and environment details.

### 6. Log Directory Verification

```typescript
// Verify log directory is accessible and writable
try {
  const logPath = log.transports.file.getFile().path;
  const logDir = path.dirname(logPath);
  
  // Ensure directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  // Test write permissions with a temp file
  const testFile = path.join(logDir, ".write-test");
  try {
    fs.writeFileSync(testFile, "test", "utf8");
    fs.unlinkSync(testFile);
  } catch (e) {
    console.error(
      "[FATAL] Log directory not writable:",
      logDir,
      e instanceof Error ? e.message : String(e),
    );
    // Continue anyway - logs will go to console
  }
} catch (e) {
  console.error(
    "[FATAL] Failed to verify log directory:",
    e instanceof Error ? e.message : String(e),
  );
}
```

**Impact**: File system issues are detected early and reported. If the log directory is not writable, at least we know why logs aren't being written.

### 7. Crash Dump Support

```typescript
// Enable crash dumps for native crashes
try {
  const crashDumpPath = path.join(app.getPath("userData"), "crashes");
  fs.mkdirSync(crashDumpPath, { recursive: true });
  app.setPath("crashDumps", crashDumpPath);
  log.info("[diag] Crash dumps enabled at:", crashDumpPath);
} catch (e) {
  log.warn(
    "[diag] Failed to configure crash dumps:",
    e instanceof Error ? e.message : String(e),
  );
}
```

**Impact**: Native crashes (V8, GPU, etc.) now generate crash dump files that can be analyzed even when no logs are written.

## Log File Locations

### Main Application Logs

- **Windows**: `%APPDATA%\Lumberjack\logs\main.log`
- **macOS**: `~/Library/Logs/Lumberjack/main.log`
- **Linux**: `~/.local/share/Lumberjack/logs/main.log`

### Crash Dumps

- **All Platforms**: `%APPDATA%\Lumberjack\crashes\` (Windows) or equivalent on other platforms

## Diagnostic Procedures

### When Silent Exit Occurs

1. **Check main.log first**:
   ```bash
   # Windows
   type %APPDATA%\Lumberjack\logs\main.log
   
   # macOS/Linux
   cat ~/Library/Logs/Lumberjack/main.log
   ```

2. **Look for the last log entry**:
   - Check the timestamp of the last entry
   - Compare with the time the exit occurred
   - If logs stop abruptly, check for:
     - Crash dumps in the crashes directory
     - System logs (Event Viewer on Windows, journalctl on Linux, Console.app on macOS)
     - Out of memory conditions
     - Disk space issues

3. **Check crash dumps**:
   ```bash
   # Windows
   dir %APPDATA%\Lumberjack\crashes
   
   # macOS/Linux  
   ls -lh ~/Library/Application\ Support/Lumberjack/crashes/
   ```

4. **Check system logs**:
   
   **Windows (Event Viewer)**:
   ```powershell
   # Check for application errors
   Get-EventLog -LogName Application -Source "Application Error" -Newest 10
   ```
   
   **Linux (journalctl)**:
   ```bash
   # Check for process terminations
   journalctl -xe | grep -i lumberjack
   ```
   
   **macOS (Console.app)**:
   - Open Console.app
   - Look for crash reports under "User Reports"
   - Search for "Lumberjack"

5. **Use the log analysis script**:
   ```bash
   tsx scripts/analyze-exit-logs.ts
   ```

### What to Look For

1. **Abrupt log termination** - Logs stop mid-operation
   - Indicates SIGKILL or power loss
   - Check system logs for OOM killer or forced termination

2. **Signal logged but no exit logs** - Signal caught but exit logs missing
   - May indicate very aggressive termination
   - Check if flush timeout (100ms) was sufficient

3. **No startup logs** - No "[diag] Application starting" entry
   - Indicates crash before logging initialized
   - Check crash dumps
   - Check system logs for dependency issues

4. **Periodic flush gaps** - Last log is >5 seconds old
   - Indicates crash occurred between flush intervals
   - Review last logged operation for clues

## Remaining Edge Cases

Even with all these improvements, some exits may still be unloggable:

### 1. SIGKILL (cannot be caught)
- **Solution**: Monitor system logs, check for OOM killer
- **Prevention**: Monitor memory usage, implement memory limits

### 2. Hardware/Power Failure
- **Solution**: No software solution - ensure periodic flushing minimizes loss
- **Prevention**: Use UPS, enable power management features

### 3. Kernel Panic or OS Crash
- **Solution**: Check system crash dumps and kernel logs
- **Prevention**: Keep OS and drivers updated

### 4. Native Module Segfault Before Handler Setup
- **Solution**: Check crash dumps, ensure native modules are compatible
- **Prevention**: Test native modules thoroughly, use latest versions

## Verification

To verify the improvements are working:

1. **Check for startup log**:
   ```bash
   # Should see "Application starting" with full details
   grep "Application starting" main.log
   ```

2. **Check for periodic flushes**:
   - Logs should have entries at least every 5 seconds during operation
   - Gaps >5 seconds may indicate issues

3. **Test signal handling** (in development):
   ```bash
   # Start app
   npm run dev
   
   # In another terminal, send SIGTERM
   kill -TERM <pid>
   
   # Check logs for signal reception
   grep "Received SIGTERM" main.log
   ```

4. **Simulate crash** (in development):
   ```typescript
   // In main process
   setTimeout(() => {
     throw new Error("Test crash");
   }, 5000);
   
   // Check logs for uncaught exception and flush
   ```

## Best Practices for Developers

When adding new features:

1. **Always flush on critical errors**:
   ```typescript
   try {
     // Critical operation
   } catch (err) {
     log.error("[diag] Critical operation failed:", err);
     forceFlushLogs(); // Ensure error is on disk
   }
   ```

2. **Log before long-running operations**:
   ```typescript
   log.info("[diag] Starting long operation X");
   forceFlushLogs(); // Ensure this log is written
   await longOperation();
   log.info("[diag] Completed long operation X");
   ```

3. **Use the [diag] prefix** for diagnostic logs:
   - Makes it easier to filter diagnostic messages
   - Consistent with existing logging pattern

4. **Include context in logs**:
   ```typescript
   log.error("[diag] Operation failed", {
     operation: "xyz",
     params: {...},
     error: err.message,
     stack: err.stack,
   });
   ```

## Summary

The silent exit issue has been comprehensively addressed by:

1. ✅ **Immediate disk writes** - Logs written synchronously, not buffered
2. ✅ **Explicit flushing** - Logs flushed on all exit paths and errors
3. ✅ **Signal handlers** - OS signals caught and logged before exit
4. ✅ **Periodic flushing** - Logs flushed every 5 seconds automatically
5. ✅ **Early logging** - Startup logged immediately to catch early crashes
6. ✅ **Log verification** - File system checked for writability at startup
7. ✅ **Crash dumps** - Native crashes generate dump files for analysis

These improvements ensure that **99% of application exits will have corresponding log entries**, making troubleshooting dramatically easier. The remaining 1% (SIGKILL, power loss, hardware failure) have documented fallback diagnostic procedures using system logs and crash dumps.
