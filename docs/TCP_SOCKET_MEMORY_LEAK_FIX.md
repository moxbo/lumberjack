# TCP Socket and HTTP Poller Memory Leak Fixes

## Problem Description

The Lumberjack application was experiencing memory leaks when using network functionality for log ingestion. The issues manifested as:

1. **Persistent memory growth** over time with active TCP connections and HTTP polling
2. **Resource exhaustion** after extended periods of use
3. **Application instability** or unexpected exits

## Root Cause Analysis

Investigation revealed several memory leak issues in `NetworkService.ts`:

### 1. TCP Socket Handler Issues

Missing Socket Cleanup Handlers:

The TCP socket handler lacked proper cleanup on disconnection:
- No 'close' event handler to clean up disconnected sockets
- No 'end' event handler to detect normal disconnection
- Event listeners were never removed, causing memory to be retained

### 2. HTTP Poller Unbounded Set Growth

**NEW ISSUE DISCOVERED**: The HTTP poller deduplication mechanism had an unbounded memory leak:
- Each HTTP poller maintains a `seen` Set to track processed log entries
- This Set grows indefinitely as new unique log entries are processed
- No mechanism to limit the Set size
- Over time, with continuous polling, the Set could consume unbounded memory

Example scenario:
- HTTP poller running for 24 hours
- Log source generates 1000 unique entries per minute
- After 24 hours: 1,440,000 entries in the seen Set
- Each entry key ~200 bytes: ~288 MB of memory just for deduplication

### 3. Unbounded Buffer Growth (TCP)
- No maximum buffer size limit
- Buffer persisted in closure even after socket closed
- Malicious clients could send data without newlines, causing unbounded memory consumption

### 4. Missing Socket Timeout (TCP)

Sockets could remain open indefinitely:
- No timeout configured on sockets
- Hanging connections would accumulate over time
- No mechanism to close idle or stalled connections

### 5. No Resource Tracking

No visibility into resource usage:
- Number of active connections not tracked
- No diagnostics available for troubleshooting
- Impossible to detect resource leaks in production

## Implemented Solutions

### 1. Comprehensive Socket Cleanup

Added proper event handlers for socket lifecycle:

```typescript
// Track active sockets for monitoring
this.activeSockets.add(socket);

// Cleanup function called on socket end/close
const cleanup = (): void => {
  this.activeSockets.delete(socket);
  buffer = ""; // Clear buffer to free memory
  socket.removeAllListeners(); // Remove all listeners to prevent leaks
};

socket.on("close", (hadError) => {
  log.debug(`[tcp] Socket closed: ${socketId}${hadError ? " (with error)" : ""}`);
  cleanup();
});

socket.on("end", () => {
  log.debug(`[tcp] Socket ended: ${socketId}`);
});
```

**Impact**: All socket resources are now properly cleaned up when connections close, preventing memory leaks.

### 2. Buffer Overflow Protection

Added maximum buffer size limits:

```typescript
// Constants for memory leak prevention
private static readonly MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer per socket
private static readonly MAX_LINE_LENGTH = 100 * 1024; // 100KB max line length

// In data handler:
if (buffer.length > NetworkService.MAX_BUFFER_SIZE) {
  log.warn(`[tcp] Buffer overflow on ${socketId}, dropping oldest data`);
  // Keep only the most recent data
  buffer = buffer.slice(buffer.length - NetworkService.MAX_BUFFER_SIZE / 2);
}

// Skip lines that are too long
if (line.length > NetworkService.MAX_LINE_LENGTH) {
  log.warn(`[tcp] Line too long on ${socketId}, skipping`);
  continue;
}
```

**Impact**: Buffers cannot grow unbounded, preventing memory exhaustion from malicious or malformed data.

### 3. Socket Timeout Configuration

Added timeout to prevent hanging connections:

```typescript
private static readonly SOCKET_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// In socket handler:
socket.setTimeout(NetworkService.SOCKET_TIMEOUT_MS);

socket.on("timeout", () => {
  log.warn(`[tcp] Socket timeout on ${socketId}, closing connection`);
  socket.end();
});
```

**Impact**: Idle connections are automatically closed after 5 minutes, preventing accumulation of stalled connections.

### 4. Active Socket Tracking

Added tracking and diagnostics:

```typescript
// Track active sockets
private activeSockets = new Set<net.Socket>();

// Enhanced getTcpStatus with connection count
getTcpStatus(): TcpStatus & { activeConnections?: number } {
  return {
    ok: true,
    message: this.tcpRunning ? `Running on port ${this.tcpPort}` : "Not running",
    running: this.tcpRunning,
    port: this.tcpRunning ? this.tcpPort : undefined,
    activeConnections: this.activeSockets.size,
  };
}

// New diagnostics method
getDiagnostics(): {
  tcp: { running: boolean; port?: number; activeConnections: number };
  http: { activePollers: number; pollerDetails: Array<...> };
}
```

**Impact**: Resource usage is now visible and can be monitored in production.

### 5. Proper Server Shutdown

Enhanced `stopTcpServer` to close all active sockets:

```typescript
stopTcpServer(): Promise<TcpStatus> {
  // Close all active sockets first
  const socketsToClose = Array.from(this.activeSockets);
  log.info(`[tcp] Stopping server, closing ${socketsToClose.length} active socket(s)`);
  
  for (const socket of socketsToClose) {
    try {
      socket.end();
    } catch (e) {
      log.warn("Error closing socket:", e);
    }
  }
  
  this.activeSockets.clear();
  
  this.tcpServer!.close(() => {
    // ... cleanup
  });
}
```

**Impact**: All sockets are properly closed when the server stops, preventing resource leaks during shutdown.

### 6. HTTP Poller Seen Set Trimming

**NEW FIX**: Added automatic trimming of the deduplication Set to prevent unbounded growth:

```typescript
private static readonly MAX_SEEN_ENTRIES = 10000; // Max deduplication entries per poller

private dedupeNewEntries(entries: LogEntry[], seen: Set<string>): LogEntry[] {
  const fresh: LogEntry[] = [];
  for (const e of entries) {
    const key = JSON.stringify([...]);
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push(e);
      
      // Prevent unbounded growth of seen Set (memory leak prevention)
      if (seen.size > NetworkService.MAX_SEEN_ENTRIES) {
        // Keep only the most recent entries
        const recentEntries = Array.from(seen).slice(-NetworkService.MAX_SEEN_ENTRIES / 2);
        seen.clear();
        recentEntries.forEach(k => seen.add(k));
        log.debug(`[http:poll] Trimmed seen Set to ${seen.size} entries`);
      }
    }
  }
  return fresh;
}
```

**Impact**: 
- Seen Set cannot grow beyond 10,000 entries
- When limit is reached, keeps the most recent 5,000 entries
- Prevents unbounded memory growth in long-running HTTP pollers
- May allow some duplicate entries after trimming, but prevents memory exhaustion

**Trade-offs**:
- Small number of duplicate log entries may be sent after Set trimming
- This is acceptable: duplicates are better than memory exhaustion
- Recent entries (most likely to be duplicates) are kept

### 7. Enhanced Diagnostics

Updated diagnostics to include HTTP poller memory usage:

```typescript
getDiagnostics(): {
  tcp: { running: boolean; port?: number; activeConnections: number };
  http: { 
    activePollers: number; 
    pollerDetails: Array<{ 
      id: number; 
      url: string; 
      intervalMs: number;
      seenEntries: number;  // NEW: Track seen Set size
    }>;
  };
}
```

**Impact**: Can now monitor HTTP poller memory usage and verify trimming is working.

## Testing

Two comprehensive test suites were added:

### TCP Socket Cleanup Tests (`scripts/test-tcp-socket-cleanup.ts`)

Verifies:
1. ✅ Sockets are properly tracked when connected
2. ✅ Sockets are properly cleaned up when disconnected normally
3. ✅ Multiple simultaneous connections work correctly
4. ✅ Buffer overflow protection prevents unbounded memory growth
5. ✅ Server properly closes all active sockets when stopped
6. ✅ Diagnostics correctly report resource usage

### HTTP Poller Memory Tests (`scripts/test-http-poller-memory.ts`)

Verifies:
1. ✅ Deduplication prevents duplicate entries
2. ✅ Seen Set is trimmed when exceeding MAX_SEEN_ENTRIES
3. ✅ Diagnostics include seen entries count
4. ✅ Large batches of entries are handled correctly

Run the tests with:
```bash
npm test
# or individually:
npx tsx scripts/test-tcp-socket-cleanup.ts
npx tsx scripts/test-http-poller-memory.ts
```

## Verification

To verify the fix is working in production:

### 1. Monitor Active Connections

```typescript
// In application code
const status = networkService.getTcpStatus();
console.log(`Active connections: ${status.activeConnections}`);
```

### 2. Check Diagnostics

```typescript
const diag = networkService.getDiagnostics();
console.log(JSON.stringify(diag, null, 2));

// Example output:
// {
//   "tcp": {
//     "running": true,
//     "port": 9999,
//     "activeConnections": 5
//   },
//   "http": {
//     "activePollers": 2,
//     "pollerDetails": [
//       {
//         "id": 1,
//         "url": "http://logs.example.com/app.log",
//         "intervalMs": 5000,
//         "seenEntries": 3421  // Monitor this value
//       }
//     ]
//   }
// }
```

**What to watch for**:
- TCP `activeConnections` should decrease when clients disconnect
- HTTP `seenEntries` should stabilize around 5,000-10,000 and not grow unbounded
```

### 3. Monitor Logs

Look for these diagnostic messages:

**TCP:**
- `[tcp] Socket connected: ...` - Connection established
- `[tcp] Socket cleaned up: ...` - Connection properly cleaned up
- `[tcp] Buffer overflow on ...` - Buffer protection activated
- `[tcp] Socket timeout on ...` - Timeout protection activated

**HTTP:**
- `[http:poll] Trimmed seen Set to ... entries` - Deduplication Set trimmed to prevent memory growth

### 4. Memory Profiling

For extended runs, monitor Node.js memory usage:
```bash
node --expose-gc --max-old-space-size=512 ...
```

Expected behavior:
- Memory usage should stabilize after initial growth
- No continuous memory growth over time
- TCP connection count should decrease when clients disconnect
- HTTP seen Set should stay between 5,000-10,000 entries

## Performance Impact

The fixes have minimal performance impact:

**TCP:**
- **Socket tracking**: O(1) add/remove operations using Set
- **Buffer checks**: O(1) length checks before processing
- **Cleanup**: Runs only on socket close, not per-message

**HTTP:**
- **Set trimming**: O(n) operation where n = MAX_SEEN_ENTRIES (10,000), runs only when limit exceeded
- **Deduplication**: O(1) Set lookup per entry

Benefits far outweigh any overhead:
- Prevents memory leaks that could crash the application
- Protects against malicious clients (TCP)
- Prevents unbounded memory growth in HTTP pollers
- Provides visibility into resource usage

## Best Practices

When working with network services in Node.js:

**TCP Sockets:**
1. **Always handle all lifecycle events**: data, error, close, end, timeout
2. **Set socket timeouts**: Prevent hanging connections
3. **Limit buffer sizes**: Prevent unbounded memory growth
4. **Track active resources**: Monitor connections, memory, etc.
5. **Clean up on errors**: Remove event listeners and free resources

**HTTP Polling:**
1. **Limit Set/Map sizes**: Implement trimming for deduplication structures
2. **Consider LRU caches**: For bounded memory with good hit rates
3. **Monitor memory usage**: Track Set/Map sizes in diagnostics
4. **Accept trade-offs**: Some duplicates are better than memory exhaustion

**General:**
1. **Test with real workloads**: Simulate production scenarios
2. **Monitor in production**: Track resource usage over time
3. **Use diagnostics**: Implement visibility into resource usage

## Related Issues

This fix addresses:
- Memory leaks in TCP server functionality
- Memory leaks in HTTP poller deduplication
- Resource exhaustion under load
- Application instability with long-running network services

## References

- Node.js net.Socket documentation: https://nodejs.org/api/net.html#class-netsocket
- Memory leak detection in Node.js: https://nodejs.org/en/docs/guides/simple-profiling/
- TCP server best practices: https://nodejs.org/en/docs/guides/anatomy-of-an-http-transaction/
