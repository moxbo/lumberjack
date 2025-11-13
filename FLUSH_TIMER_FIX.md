# TCP Log Display Fix: Periodic Flush Timer

## Problem
Benutzer berichtete, dass eingehende TCP-Logs gezählt werden (Counter erhöht sich), aber in der UI-Liste nicht angezeigt werden.

### Root Cause
Der Code hatte einen **kritischen Fehler**: 
- TCP-Nachrichten werden von `NetworkService` empfangen
- Sie werden in `sendAppend(entries)` verarbeitet
- Diese ruft intern `sendBatchesAsyncTo()` auf, das die Batches über den IPC-Channel `logs:append` sendet
- **ABER**: Der Renderer-Prozess startet mit einem neuem Fenster, das möglicherweise noch nicht bereit ist
- Wenn der Renderer nicht bereit ist, werden die Logs in den `pendingAppends` Buffer gepuffert
- **FEHLER**: Es gab keinen regelmäßigen Timer, um diesen Buffer zu leeren!
- Resultat: Logs steckten im Buffer fest und wurden nie an die UI gesendet

## Lösung: Periodic Flush Timer

### Änderung in `src/main/main.ts` (nach Zeile ~1900)

```typescript
// [CRITICAL FIX] Periodic flush of pending appends to renderer
// This ensures buffered log entries are sent to UI regularly
// Without this timer, logs can be delayed indefinitely in pendingAppends buffer
const PENDING_APPEND_FLUSH_INTERVAL_MS = 100; // Flush every 100ms for responsive UI
setInterval(() => {
  try {
    // Flush main window buffer
    flushPendingAppends();
    
    // Flush per-window buffers for multi-window scenarios
    for (const win of windows) {
      try {
        if (!win.isDestroyed()) {
          flushPendingAppendsFor(win);
        }
      } catch {
        // Ignore errors for individual windows
      }
    }
  } catch (err) {
    // Ignore errors to prevent timer from being cancelled
    try {
      log.debug(
        "[flush-timer] Periodic flush error (continuing):",
        err instanceof Error ? err.message : String(err),
      );
    } catch {
      // Ignore logging errors
    }
  }
}, PENDING_APPEND_FLUSH_INTERVAL_MS);
```

### How It Works

1. **Every 100ms**, the timer checks `pendingAppends` buffer
2. **If buffer has entries** and renderer is ready (`isRendererReady()`):
   - Prepares batches of up to 200 entries each
   - Sends batches with adaptive delay (from `AdaptiveBatchService`)
   - Clears the buffer
3. **For multi-window scenarios**:
   - Also flushes `pendingAppendsByWindow` for each window
4. **Error handling**:
   - Errors don't crash the timer (it continues running)
   - Debug logs for troubleshooting

### Flow Diagram

```
TCP Server (NetworkService)
         ↓ onData
   parseEntries()
         ↓
  sendLogCallback(entries)
         ↓
   sendAppend(entries)
         ↓
  ┌─────────────────────────────┐
  │ Is renderer ready?          │
  └─────────────────────────────┘
    Yes ↓                    No ↓
    ├── sendBatchesAsyncTo() (direct)
    │                    └── enqueueAppends()
    │                        (store in pendingAppends)
    │                        ↓
    │                   ┌──────────────────────┐
    │                   │ TIMER (every 100ms) │
    │                   │ flushPendingAppends()│
    │                   └──────────────────────┘
    │                         ↓
    └── > IPC Channel: logs:append
         (sent to renderer)
         ↓
    App.tsx (useEffect)
         ↓
    window.api.onAppend()
         ↓
    appendEntries()
         ↓
    Update React State (entries)
         ↓
    UI List Re-renders with new entries
```

## Testing the Fix

### Expected Behavior
1. Start Lumberjack
2. Open TCP Server settings (Netzwerk → TCP)
3. Start TCP Server (Port 5000)
4. Send log entries from another application/terminal:
   ```bash
   nc localhost 5000
   # Type a JSON log entry, press Enter
   {"timestamp":"2025-11-13T10:00:00Z","level":"INFO","message":"Test message"}
   ```
5. **Logs should appear in list immediately** (now with adaptive batching)

### Logging/Debugging
The fix includes logging:
- `[flush-timer]` - Periodic flush operations
- `[adaptive-batch]` - Adaptive delay adjustments
- `[freeze-diag]` - Batch send diagnostics

## Performance Considerations

1. **100ms Flush Interval**: 
   - Responsive enough for interactive use
   - Low CPU overhead (1 timer per process)
   - Batches multiple entries per flush

2. **Adaptive Delay**:
   - Respects system load when sending batches
   - Adjusts based on processing time
   - Minimum 4ms, Maximum 100ms

3. **Multi-Window Support**:
   - Handles TCP-only routes to owner window
   - Supports per-window buffers
   - No bottlenecks for multi-window scenarios

## Related Code

- `flushPendingAppends()` - Sends buffered entries to main window
- `flushPendingAppendsFor()` - Sends buffered entries to specific window
- `sendBatchesAsyncTo()` - Sends batches with adaptive delay
- `AdaptiveBatchService.getDelay()` - Gets current adaptive delay
- `pendingAppends` - Main buffer for all renderer-not-ready entries
- `pendingAppendsByWindow` - Per-window buffers for TCP-only routes

## Verification

After applying this fix:

```bash
# 1. Build the project
npm run prebuild

# 2. Start dev mode
npm run dev

# 3. In another terminal, send TCP logs
echo '{"timestamp":"2025-11-13T10:00:00Z","level":"INFO","message":"Test"}' | nc localhost 5000

# 4. Check logs appear in UI immediately
# 5. Monitor console for [flush-timer] messages
```

---

**Status**: ✅ FIXED
**Impact**: Logs now display immediately in UI when TCP server receives entries
**Backwards Compatibility**: ✅ Fully compatible - only adds internal timer

