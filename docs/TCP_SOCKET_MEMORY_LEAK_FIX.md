# TCP Socket Memory Leak Fix

## Problem Description

The Lumberjack application was experiencing memory leaks when using TCP server functionality for log ingestion. The issue manifested as:

1. **Persistent memory growth** over time with active TCP connections
2. **Resource exhaustion** after extended periods of use
3. **Application instability** or unexpected exits

## Root Cause Analysis

Investigation revealed several memory leak issues in `NetworkService.ts`:

### 1. Missing Socket Cleanup Handlers

The TCP socket handler lacked proper cleanup on disconnection:
- No 'close' event handler to clean up disconnected sockets
- No 'end' event handler to detect normal disconnection
- Event listeners were never removed, causing memory to be retained

### 2. Unbounded Buffer Growth

The per-socket `buffer` variable could grow indefinitely:
- No maximum buffer size limit
- Buffer persisted in closure even after socket closed
- Malicious clients could send data without newlines, causing unbounded memory consumption

### 3. Missing Socket Timeout

Sockets could remain open indefinitely:
- No timeout configured on sockets
- Hanging connections would accumulate over time
- No mechanism to close idle or stalled connections

### 4. No Resource Tracking

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

## Testing

A comprehensive test suite was added in `scripts/test-tcp-socket-cleanup.ts` that verifies:

1. ✅ Sockets are properly tracked when connected
2. ✅ Sockets are properly cleaned up when disconnected normally
3. ✅ Multiple simultaneous connections work correctly
4. ✅ Buffer overflow protection prevents unbounded memory growth
5. ✅ Server properly closes all active sockets when stopped
6. ✅ Diagnostics correctly report resource usage

Run the test with:
```bash
npm test
# or
npx tsx scripts/test-tcp-socket-cleanup.ts
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
```

### 3. Monitor Logs

Look for these diagnostic messages:
- `[tcp] Socket connected: ...` - Connection established
- `[tcp] Socket cleaned up: ...` - Connection properly cleaned up
- `[tcp] Buffer overflow on ...` - Buffer protection activated
- `[tcp] Socket timeout on ...` - Timeout protection activated

### 4. Memory Profiling

For extended runs, monitor Node.js memory usage:
```bash
node --expose-gc --max-old-space-size=512 ...
```

Expected behavior:
- Memory usage should stabilize after initial growth
- No continuous memory growth over time
- Connection count should decrease when clients disconnect

## Performance Impact

The fixes have minimal performance impact:

- **Socket tracking**: O(1) add/remove operations using Set
- **Buffer checks**: O(1) length checks before processing
- **Cleanup**: Runs only on socket close, not per-message

Benefits far outweigh any overhead:
- Prevents memory leaks that could crash the application
- Protects against malicious clients
- Provides visibility into resource usage

## Best Practices

When working with TCP sockets in Node.js:

1. **Always handle all lifecycle events**: data, error, close, end, timeout
2. **Set socket timeouts**: Prevent hanging connections
3. **Limit buffer sizes**: Prevent unbounded memory growth
4. **Track active resources**: Monitor connections, memory, etc.
5. **Clean up on errors**: Remove event listeners and free resources
6. **Test with real workloads**: Simulate production scenarios
7. **Monitor in production**: Track resource usage over time

## Related Issues

This fix addresses:
- Memory leaks in TCP server functionality
- Resource exhaustion under load
- Application instability with long-running TCP connections

## References

- Node.js net.Socket documentation: https://nodejs.org/api/net.html#class-netsocket
- Memory leak detection in Node.js: https://nodejs.org/en/docs/guides/simple-profiling/
- TCP server best practices: https://nodejs.org/en/docs/guides/anatomy-of-an-http-transaction/
