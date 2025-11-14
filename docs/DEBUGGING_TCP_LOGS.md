# TCP Log Display Debugging Guide

## Problem
TCP logs are being received (counter shows 10,174) but the log list remains empty.

## Diagnostic Steps

### 1. Open Developer Tools
Press **F12** or **Ctrl+Shift+I** (Windows/Linux) or **Cmd+Option+I** (Mac) to open DevTools.

### 2. Clear Console
Click the "Clear console" button or type `console.clear()` to start fresh.

### 3. Start TCP Server
1. In Lumberjack, start the TCP server
2. Configure your application to send logs to the TCP port
3. Send some test logs

### 4. Check Console Output
Look for these diagnostic messages:

#### Main Process (Electron) Logs
- `[tcp-diag] sendAppend called: X total, Y TCP, Z other`
  - Confirms logs are received by NetworkService
  - Shows how many are TCP vs. other sources

- `[tcp-diag] TCP owner window ID: N`
  - Shows which window should receive TCP logs
  - `null` means logs go to main window

- `[tcp-diag] Sending X TCP entries directly to owner window N`
  - Logs are sent immediately (window is ready)

- `[tcp-diag] Owner window N not ready, enqueueing X TCP entries`
  - Logs are buffered (window not ready yet)

- `[flush-timer] Run #N: pendingAppends=X, windows=Y, hasWindowPending=true/false`
  - Flush timer is running
  - Shows buffer sizes

- `[flush-diag] Flushing X pending appends to main window`
  - Buffer is being flushed to window

- `[ipc-diag] Sending IPC batch on channel "logs:append": X entries`
  - IPC message is being sent to renderer

#### Renderer Process Logs
- `[renderer-diag] Setting up onAppend listener`
  - Renderer is ready to receive logs

- `[renderer-diag] Received IPC logs:append with X entries`
  - Renderer received IPC message

- `[renderer-diag] appendEntries called with X entries, isArray: true`
  - appendEntries function is called

- `[renderer-diag] Adding X entries to state (after dedup from Y)`
  - Entries are being added to React state

- `[renderer-diag] State updated: A -> B entries`
  - State was updated from A to B entries

- `[filter-diag] Filter stats: { total: X, passed: Y, rejectedBy... }`
  - Shows which filters are rejecting entries
  - **CRITICAL**: If `passed: 0` but `total: X`, all entries are filtered out!

### 5. Identify the Problem

#### Problem A: Logs Not Reaching Renderer
If you see `[tcp-diag]` and `[ipc-diag]` messages but NO `[renderer-diag]` messages:
- **Issue**: IPC messages not being received by renderer
- **Fix**: Window might not be loaded yet, check `did-finish-load` event

#### Problem B: Logs Filtered Out
If you see `[filter-diag]` with `passed: 0`:
- **Issue**: All entries are being filtered out
- **Check**:
  1. Is "Nur markierte an" (Only marked) enabled? → Disable it
  2. Are standard filters active with values set?
  3. Is DC-Filter enabled with active filters?
  4. Look at `rejectedByDC`, `rejectedByLevel`, etc. in filter stats

#### Problem C: Logs Not Being Sent
If you see NO `[tcp-diag]` messages:
- **Issue**: NetworkService not calling sendAppend
- **Check**: Is TCP server actually running? Are logs being sent to it?

### 6. Common Solutions

#### Solution 1: Disable Filters
If logs are being filtered out:
1. Uncheck "Standard-Filter aktiv" checkbox
2. Click "Filter leeren" to clear all filters
3. Close DC-Filter dialog if open

#### Solution 2: Wait for Window to Load
If logs are being queued:
- Wait a few seconds for the window to finish loading
- Check if `[window-ready]` message appears
- Check if `[flush-diag]` messages show flushing

#### Solution 3: Restart Application
If nothing works:
1. Close Lumberjack completely
2. Restart it
3. Start TCP server AFTER window is fully loaded

## Expected Console Output (Working Scenario)

```
[window-ready] Window 1 finished loading, marked as ready
[tcp-diag] sendAppend called: 100 total, 100 TCP, 0 other
[tcp-diag] TCP owner window ID: 1
[tcp-diag] Sending 100 TCP entries directly to owner window 1
[ipc-diag] Sending IPC batch on channel "logs:append": 50 entries
[ipc-diag] Sending IPC batch on channel "logs:append": 50 entries
[renderer-diag] Received IPC logs:append with 50 entries
[renderer-diag] appendEntries called with 50 entries, isArray: true
[renderer-diag] Adding 50 entries to state (after dedup from 50)
[renderer-diag] State updated: 0 -> 50 entries
[filter-diag] Filter stats: { total: 50, passed: 50, rejectedBy...: 0 }
[renderer-diag] Received IPC logs:append with 50 entries
[renderer-diag] appendEntries called with 50 entries, isArray: true
[renderer-diag] Adding 50 entries to state (after dedup from 50)
[renderer-diag] State updated: 50 -> 100 entries
[filter-diag] Filter stats: { total: 100, passed: 100, rejectedBy...: 0 }
```

## Share Your Console Output

Copy ALL console output and share it in the GitHub issue. This will help identify exactly where the problem is.
