# Exit Code 1 Debugging Guide

## Problem Description

The Lumberjack application was experiencing sporadic/random exits with exit code 1. This exit code is typically used to indicate a general error condition in applications.

## Root Cause Analysis

Exit code 1 in Electron applications can occur due to several reasons:

1. **Uncaught Exceptions**: Unhandled JavaScript errors in the main process
2. **Unhandled Promise Rejections**: Rejected promises without `.catch()` handlers
3. **Renderer Process Crashes**: The renderer (UI) process crashing or exiting unexpectedly
4. **Child Process Failures**: GPU or other child processes failing
5. **Electron Framework Issues**: Internal Electron errors or crashes

## Implemented Solution

### 1. Comprehensive Diagnostic Logging

All potential exit paths are now instrumented with detailed logging:

```typescript
// Track exit source for debugging
let exitSource = "unknown";
let exitDetails: any = null;

process.on("uncaughtException", (err, origin) => {
  // Logs include: origin, stack trace, error name, and message
  // Logs to both electron-log and console (stderr) for visibility
});

process.on("unhandledRejection", (reason, promise) => {
  // Logs the rejection reason and promise details
});

process.on("beforeExit", (code) => {
  // Logs exit code, source, and whether quit was confirmed
});

process.on("exit", (code) => {
  // Final exit logging with all diagnostic details
});
```

### 2. Enhanced Error Handling

#### Renderer Process Recovery

```typescript
wc.on("render-process-gone", (_e, details) => {
  // Intelligent recovery based on crash reason
  // - Reloads window for crashes, OOM, or launch failures
  // - Creates new window if current one is destroyed
  // - Waits 500ms to avoid rapid crash loops
});

wc.on("did-fail-load", (_e, errorCode, errorDescription) => {
  // Automatic reload for critical errors (after 1 second delay)
  // Ignores harmless errors like ERR_ABORTED (-3)
});
```

#### App Lifecycle Protection

```typescript
app.whenReady()
  .then(() => {
    // Wrapped in try-catch with fallback window creation
  })
  .catch((err) => {
    // Logs error but doesn't exit - tries to continue
  });
```

#### Window Recovery

```typescript
app.on("window-all-closed", () => {
  if (!quitConfirmed) {
    // Recreates window instead of exiting
    // Only quits if user explicitly confirmed
  }
});
```

### 3. Electron-Level Crash Detection

```typescript
app.on("child-process-gone", (_event, details) => {
  // Logs child process crashes (GPU, etc.)
});

app.on("render-process-gone", (_event, webContents, details) => {
  // Logs renderer crashes with reason and exit code
});
```

## Diagnostic Tools

### Log Analysis Script

A new diagnostic script is available to analyze log files:

```bash
# Analyze default log location
tsx scripts/analyze-exit-logs.ts

# Analyze specific log file
tsx scripts/analyze-exit-logs.ts /path/to/main.log
```

The script provides:
- Summary of exit events
- Detection of exit code 1 occurrences
- Recent errors before exit
- Exit-related diagnostic messages
- Recommendations for fixing issues

### Log File Locations

Default log locations by platform:

- **Windows**: `%APPDATA%\Lumberjack\logs\main.log`
- **macOS**: `~/Library/Logs/Lumberjack/main.log`
- **Linux**: `~/.local/share/Lumberjack/logs/main.log`

## What to Look For in Logs

When analyzing logs for exit code 1 issues, look for:

1. **[diag] uncaughtException** - Indicates an unhandled error
   - Check the stack trace to identify the source
   - Look at the origin (e.g., "uncaughtException", "unhandledRejection")

2. **[diag] unhandledRejection** - Indicates a promise rejection
   - Check what promise was rejected
   - Trace back to find the async operation that failed

3. **[diag] render-process-gone** - Renderer crash
   - Check the reason (crashed, oom, launch-failed, etc.)
   - Look for errors immediately before the crash

4. **[diag] child-process-gone** - Child process failure
   - Check which child process (GPU, etc.)
   - Look for graphics/hardware-related issues

5. **[diag] beforeExit** with non-zero code
   - Indicates abnormal exit
   - Check the exitSource field to see what triggered it

## Prevention Best Practices

### 1. Always Handle Promise Rejections

```typescript
// ❌ Bad - can cause exit code 1
someAsyncFunction();

// ✅ Good
someAsyncFunction().catch(err => {
  log.error("Error in someAsyncFunction:", err);
});
```

### 2. Wrap Risky Operations in Try-Catch

```typescript
// ❌ Bad
const result = riskyOperation();

// ✅ Good
try {
  const result = riskyOperation();
} catch (err) {
  log.error("riskyOperation failed:", err);
  // Handle error gracefully
}
```

### 3. Use Proper Event Handlers

```typescript
// ✅ All critical events have handlers
ipcMain.handle("some-operation", async () => {
  try {
    // Operation logic
    return { ok: true, result };
  } catch (err) {
    log.error("Operation failed:", err);
    return { ok: false, error: err.message };
  }
});
```

### 4. Monitor Renderer Process Health

The app now automatically:
- Detects renderer crashes
- Attempts recovery by reloading
- Creates new windows if recovery fails
- Prevents rapid crash loops with delays

## Testing for Exit Code 1

To test if the improvements are working:

1. **Run the app normally**:
   ```bash
   npm run dev
   ```

2. **Check logs for diagnostic messages**:
   - All handlers should log "[diag]" messages
   - Look for "IPC handlers registered successfully"
   - Verify no uncaught exceptions

3. **Simulate crashes** (for testing recovery):
   - In renderer: `throw new Error("Test crash")`
   - In main: Trigger an error in an async operation
   - Check that the app recovers instead of exiting

4. **Analyze logs after running**:
   ```bash
   tsx scripts/analyze-exit-logs.ts
   ```

## Expected Behavior

With these improvements:

1. **Normal exit (exit code 0)**:
   - User clicks "Quit" and confirms
   - Logs show `[diag] before-quit fired; quitConfirmed=true`
   - Clean shutdown with exit code 0

2. **Abnormal exit (previously exit code 1, now recovered)**:
   - Uncaught exception occurs
   - Logged with full stack trace
   - App continues running instead of crashing
   - Window recovers automatically if needed

3. **Intentional crash (for debugging)**:
   - Still logged with full diagnostic details
   - Can be analyzed with the diagnostic script
   - Root cause is clearly identified in logs

## Troubleshooting

If exit code 1 still occurs:

1. **Check the logs**:
   ```bash
   tsx scripts/analyze-exit-logs.ts
   ```

2. **Look for patterns**:
   - Does it happen at startup?
   - Does it happen during specific operations?
   - Is it related to network operations (TCP/HTTP)?

3. **Enable verbose logging** (if needed):
   - The app already logs at "debug" level in console
   - File logs capture "silly" level (all messages)

4. **Report the issue** with:
   - Output from `analyze-exit-logs.ts`
   - Steps to reproduce
   - Relevant log excerpts showing the error

## Summary

The sporadic exit code 1 issue has been addressed by:

1. ✅ Adding comprehensive diagnostic logging for all exit paths
2. ✅ Implementing intelligent error recovery for renderer crashes
3. ✅ Wrapping critical operations in try-catch blocks
4. ✅ Creating a diagnostic tool to analyze logs
5. ✅ Preventing exit code 1 from uncaught errors where possible
6. ✅ Logging all errors for post-mortem analysis

The application should now be more resilient and provide clear diagnostic information when issues occur, making it easier to identify and fix any remaining edge cases.
