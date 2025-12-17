/**
 * NetworkService
 * Manages TCP server and HTTP polling operations
 */

import * as net from "net";
import log from "electron-log/main";
import type { LogEntry } from "../types/ipc";

/**
 * TCP Status
 */
export interface TcpStatus {
  ok: boolean;
  message: string;
  running: boolean;
  port?: number;
}

/**
 * HTTP Poll configuration
 */
export interface HttpPollConfig {
  id: number;
  url: string;
  intervalSec: number;
  timer: NodeJS.Timeout;
  seen: Set<string>;
  abortController: AbortController; // Used to abort pending fetches on stop
  stopped: boolean; // Flag to prevent new ticks after stop
}

/**
 * Log entry callback
 */
export type LogCallback = (entries: LogEntry[]) => void;

/**
 * JSON parser function type
 */
export type JsonParserFn = (url: string, text: string) => LogEntry[];

/**
 * Text parser function type
 */
export type TextParserFn = (url: string, text: string) => LogEntry[];

/**
 * Entry converter function type
 */
export type EntryConverterFn = (
  obj: Record<string, unknown>,
  fallback: string,
  source: string,
) => LogEntry;

/**
 * NetworkService manages TCP and HTTP network operations
 */
export class NetworkService {
  private tcpServer: net.Server | null = null;
  private tcpRunning = false;
  private tcpPort = 0;
  private httpPollers = new Map<number, HttpPollConfig>();
  private httpPollerSeq = 1;
  private logCallback: LogCallback | null = null;
  private parseJsonFile: JsonParserFn | null = null;
  private parseTextLines: TextParserFn | null = null;
  private toEntry: EntryConverterFn | null = null;

  // Memory leak prevention constants
  private static readonly MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB max buffer per socket
  private static readonly SOCKET_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout
  private static readonly MAX_LINE_LENGTH = 5 * 1024 * 1024; // 5MB max line length (will be truncated in renderer)
  private static readonly MAX_SEEN_ENTRIES = 10000; // Max deduplication entries per poller

  // Additional robustness constants
  private static readonly HTTP_FETCH_TIMEOUT_MS = 30 * 1000; // 30 seconds HTTP timeout
  private static readonly HTTP_MAX_RESPONSE_SIZE = 100 * 1024 * 1024; // 100MB max response size
  private static readonly TCP_MAX_CONNECTIONS = 1000; // Max concurrent TCP connections

  // Track active sockets for monitoring
  private activeSockets = new Set<net.Socket>();

  // TCP batching for improved throughput
  private static readonly TCP_BATCH_SIZE = 500; // Max entries per batch
  private static readonly TCP_BATCH_INTERVAL_MS = 50; // Flush interval in ms
  private tcpBatchQueue: LogEntry[] = [];
  private tcpBatchTimer: NodeJS.Timeout | null = null;

  // HTTP batching for improved throughput (similar to TCP)
  // Reduced batch size to prevent UI freezes ("Keine Rückmeldung")
  private static readonly HTTP_BATCH_SIZE = 100; // Max entries per batch (reduced from 500)
  private static readonly HTTP_BATCH_INTERVAL_MS = 16; // Flush interval in ms (one frame at 60fps)
  private httpBatchQueue: LogEntry[] = [];
  private httpBatchTimer: NodeJS.Timeout | null = null;

  /**
   * Set the log callback function
   */
  setLogCallback(callback: LogCallback): void {
    this.logCallback = callback;
  }

  /**
   * Queue a TCP entry for batched sending
   * This significantly improves throughput for high-volume TCP streams
   */
  private queueTcpEntry(entry: LogEntry): void {
    this.tcpBatchQueue.push(entry);

    // Flush immediately if batch is full
    if (this.tcpBatchQueue.length >= NetworkService.TCP_BATCH_SIZE) {
      this.flushTcpBatch();
      return;
    }

    // Schedule flush if not already scheduled
    if (!this.tcpBatchTimer) {
      this.tcpBatchTimer = setTimeout(() => {
        this.flushTcpBatch();
      }, NetworkService.TCP_BATCH_INTERVAL_MS);
    }
  }

  /**
   * Flush the TCP batch queue
   */
  private flushTcpBatch(): void {
    if (this.tcpBatchTimer) {
      clearTimeout(this.tcpBatchTimer);
      this.tcpBatchTimer = null;
    }

    if (this.tcpBatchQueue.length === 0) {
      return;
    }

    const batch = this.tcpBatchQueue;
    this.tcpBatchQueue = [];

    log.debug(`[tcp] Flushing batch of ${batch.length} entries`);
    this.sendLogs(batch);
  }

  /**
   * Queue HTTP entries for batched sending
   * This significantly improves throughput for high-volume HTTP responses
   */
  private queueHttpEntries(entries: LogEntry[]): void {
    this.httpBatchQueue.push(...entries);

    // Flush immediately if batch is full
    if (this.httpBatchQueue.length >= NetworkService.HTTP_BATCH_SIZE) {
      this.flushHttpBatch();
      return;
    }

    // Schedule flush if not already scheduled
    if (!this.httpBatchTimer) {
      this.httpBatchTimer = setTimeout(() => {
        this.flushHttpBatch();
      }, NetworkService.HTTP_BATCH_INTERVAL_MS);
    }
  }

  /**
   * Flush the HTTP batch queue
   */
  private flushHttpBatch(): void {
    if (this.httpBatchTimer) {
      clearTimeout(this.httpBatchTimer);
      this.httpBatchTimer = null;
    }

    if (this.httpBatchQueue.length === 0) {
      return;
    }

    const batch = this.httpBatchQueue;
    this.httpBatchQueue = [];

    log.debug(`[http] Flushing batch of ${batch.length} entries`);
    this.sendLogs(batch);
  }

  /**
   * Set parser functions (injected from parsers module)
   */
  setParsers(parsers: {
    parseJsonFile: JsonParserFn;
    parseTextLines: TextParserFn;
    toEntry: EntryConverterFn;
  }): void {
    this.parseJsonFile = parsers.parseJsonFile;
    this.parseTextLines = parsers.parseTextLines;
    this.toEntry = parsers.toEntry;
  }

  /**
   * Send log entries to the callback
   */
  private sendLogs(entries: LogEntry[]): void {
    if (this.logCallback && entries.length > 0) {
      this.logCallback(entries);
    }
  }

  /**
   * Start TCP server
   */
  startTcpServer(port: number): Promise<TcpStatus> {
    if (this.tcpServer) {
      return Promise.resolve({
        ok: false,
        message: "TCP server already running",
        running: true,
        port: this.tcpPort,
      });
    }

    if (!this.toEntry) {
      return Promise.resolve({
        ok: false,
        message: "Parser functions not set",
        running: false,
      });
    }

    const toEntry = this.toEntry;

    const server = net.createServer((socket) => {
      // Check connection limit before accepting
      if (this.activeSockets.size >= NetworkService.TCP_MAX_CONNECTIONS) {
        log.warn(
          `[tcp] Connection limit reached (${NetworkService.TCP_MAX_CONNECTIONS}), rejecting connection from ${socket.remoteAddress}:${socket.remotePort}`,
        );
        socket.end(); // Gracefully close the connection
        return;
      }

      let buffer = "";
      const remoteAddr = socket.remoteAddress ?? "unknown";
      const remotePort = socket.remotePort ?? 0;
      const socketId = `${remoteAddr}:${remotePort}`;

      // Track socket for monitoring
      this.activeSockets.add(socket);
      log.debug(
        `[tcp] Socket connected: ${socketId} (active: ${this.activeSockets.size})`,
      );

      // Log warning when approaching connection limit
      if (this.activeSockets.size >= NetworkService.TCP_MAX_CONNECTIONS * 0.8) {
        log.warn(
          `[tcp] Approaching connection limit: ${this.activeSockets.size}/${NetworkService.TCP_MAX_CONNECTIONS}`,
        );
      }

      // Set socket timeout to prevent hanging connections
      socket.setTimeout(NetworkService.SOCKET_TIMEOUT_MS);

      // Cleanup function to be called on socket end/close
      const cleanup = (): void => {
        if (this.activeSockets.has(socket)) {
          this.activeSockets.delete(socket);
          log.debug(
            `[tcp] Socket cleaned up: ${socketId} (active: ${this.activeSockets.size})`,
          );
        }
        // Clear buffer to free memory
        buffer = "";
        // Remove all listeners to prevent memory leaks
        socket.removeAllListeners();
      };

      socket.on("data", (chunk) => {
        try {
          // Prevent buffer from growing too large (memory leak prevention)
          if (buffer.length > NetworkService.MAX_BUFFER_SIZE) {
            log.warn(
              `[tcp] Buffer overflow on ${socketId}, dropping oldest data. Buffer size: ${buffer.length} bytes`,
            );
            // Keep only the most recent data
            buffer = buffer.slice(
              buffer.length - NetworkService.MAX_BUFFER_SIZE / 2,
            );
          }

          buffer += chunk.toString("utf8");
          let idx: number;

          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);

            if (!line) continue;

            // Skip lines that are too long (potential attack or malformed data)
            if (line.length > NetworkService.MAX_LINE_LENGTH) {
              log.warn(
                `[tcp] Line too long on ${socketId}, skipping. Length: ${line.length} bytes`,
              );
              continue;
            }

            // Parse JSON line, fallback to plain text
            let obj: Record<string, unknown>;
            try {
              obj = JSON.parse(line) as Record<string, unknown>;
            } catch (e) {
              log.warn(
                "TCP JSON parse failed, treating as plain text:",
                e instanceof Error ? e.message : String(e),
              );
              obj = { message: line };
            }

            const entry = toEntry(obj, "", `tcp:${remoteAddr}:${remotePort}`);
            this.queueTcpEntry(entry);
          }
        } catch (err) {
          log.error(
            `[tcp] Error processing data on ${socketId}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      });

      socket.on("error", (err) => {
        log.warn(`[tcp] Socket error on ${socketId}:`, err.message);
        const errorEntry = toEntry(
          { level: "ERROR", message: `TCP socket error: ${err.message}` },
          "",
          "tcp",
        );
        this.sendLogs([errorEntry]);
      });

      socket.on("timeout", () => {
        log.warn(`[tcp] Socket timeout on ${socketId}, closing connection`);
        socket.end();
      });

      socket.on("close", (hadError) => {
        log.debug(
          `[tcp] Socket closed: ${socketId}${hadError ? " (with error)" : ""}`,
        );
        cleanup();
      });

      socket.on("end", () => {
        log.debug(`[tcp] Socket ended: ${socketId}`);
      });
    });

    this.tcpServer = server;

    return new Promise<TcpStatus>((resolve) => {
      const onError = (err: Error): void => {
        log.error("TCP server error during startup:", err);
        // Cleanup server so we don't appear as running on next start
        try {
          server.removeListener("listening", onListening);
        } catch (e) {
          log.warn(
            "Removing listening listener failed:",
            e instanceof Error ? e.message : String(e),
          );
        }
        try {
          server.close();
        } catch (e) {
          log.warn(
            "Closing TCP server after error failed:",
            e instanceof Error ? e.message : String(e),
          );
        }
        this.tcpServer = null;
        this.tcpRunning = false;
        this.tcpPort = 0;
        resolve({
          ok: false,
          message: err.message,
          running: false,
        });
      };

      const onListening = (): void => {
        try {
          server.removeListener("error", onError);
        } catch (e) {
          log.warn(
            "Removing error listener failed:",
            e instanceof Error ? e.message : String(e),
          );
        }

        // Get the actual port if 0 was specified (auto-assign)
        const address = server.address();
        const actualPort =
          address && typeof address === "object" ? address.port : port;

        this.tcpRunning = true;
        this.tcpPort = actualPort;
        log.info(`TCP server listening on port ${actualPort}`);
        // Attach a general error logger for runtime errors (does not change running state)
        server.on("error", (err) => {
          log.error("TCP server runtime error:", err);
        });
        resolve({
          ok: true,
          message: `Listening on ${actualPort}`,
          running: true,
          port: actualPort,
        });
      };

      server.once("error", onError);
      server.once("listening", onListening);

      server.listen(port);
    });
  }

  /**
   * Stop TCP server
   */
  stopTcpServer(): Promise<TcpStatus> {
    if (!this.tcpServer) {
      return Promise.resolve({
        ok: false,
        message: "TCP server not running",
        running: false,
      });
    }

    // Flush any pending batched entries before stopping
    this.flushTcpBatch();

    return new Promise<TcpStatus>((resolve) => {
      // Close all active sockets first
      const socketsToClose = Array.from(this.activeSockets);
      log.info(
        `[tcp] Stopping server, closing ${socketsToClose.length} active socket(s)`,
      );

      for (const socket of socketsToClose) {
        try {
          socket.end();
        } catch (e) {
          log.warn(
            "Error closing socket:",
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      this.activeSockets.clear();

      this.tcpServer!.close(() => {
        this.tcpServer = null;
        this.tcpRunning = false;
        this.tcpPort = 0;
        log.info("TCP server stopped");
        resolve({
          ok: true,
          message: "TCP server stopped",
          running: false,
        });
      });
    });
  }

  /**
   * Get TCP server status
   */
  getTcpStatus(): TcpStatus & { activeConnections?: number } {
    return {
      ok: true,
      message: this.tcpRunning
        ? `Running on port ${this.tcpPort}`
        : "Not running",
      running: this.tcpRunning,
      port: this.tcpRunning ? this.tcpPort : undefined,
      activeConnections: this.activeSockets.size,
    };
  }

  /**
   * Fetch text from HTTP URL with timeout and size limits
   * @param url - URL to fetch
   * @param externalSignal - Optional AbortSignal to allow external cancellation (e.g., on poll stop)
   */
  private async httpFetchText(
    url: string,
    externalSignal?: AbortSignal,
  ): Promise<string> {
    if (typeof fetch === "function") {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        log.warn(
          `[http:fetch] Request timeout after ${NetworkService.HTTP_FETCH_TIMEOUT_MS}ms: ${url}`,
        );
      }, NetworkService.HTTP_FETCH_TIMEOUT_MS);

      // If external signal is provided, abort on external signal
      const onExternalAbort = () => {
        controller.abort();
        log.debug(`[http:fetch] Request aborted by external signal: ${url}`);
      };
      if (externalSignal) {
        if (externalSignal.aborted) {
          clearTimeout(timeoutId);
          throw new Error("Request aborted before start");
        }
        externalSignal.addEventListener("abort", onExternalAbort);
      }

      try {
        const res = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }

        // Check Content-Length header if available
        const contentLength = res.headers.get("content-length");
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (size > NetworkService.HTTP_MAX_RESPONSE_SIZE) {
            throw new Error(
              `Response too large: ${size} bytes (max: ${NetworkService.HTTP_MAX_RESPONSE_SIZE})`,
            );
          }
        }

        // Read response with size limit check
        const text = await res.text();
        if (text.length > NetworkService.HTTP_MAX_RESPONSE_SIZE) {
          log.warn(
            `[http:fetch] Response size ${text.length} exceeds limit ${NetworkService.HTTP_MAX_RESPONSE_SIZE}, truncating`,
          );
          return text.slice(0, NetworkService.HTTP_MAX_RESPONSE_SIZE);
        }

        return text;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Check if it was external abort (poll stopped) vs timeout
          if (externalSignal?.aborted) {
            throw new Error("Request aborted (poll stopped)");
          }
          throw new Error(
            `Request timeout after ${NetworkService.HTTP_FETCH_TIMEOUT_MS}ms`,
          );
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
        if (externalSignal) {
          externalSignal.removeEventListener("abort", onExternalAbort);
        }
      }
    }
    throw new Error("fetch unavailable");
  }

  /**
   * Deduplicate new entries based on key fields
   * Limits the size of the seen Set to prevent unbounded memory growth
   */
  private dedupeNewEntries(entries: LogEntry[], seen: Set<string>): LogEntry[] {
    const fresh: LogEntry[] = [];
    for (const e of entries) {
      const key = JSON.stringify([
        e.timestamp,
        e.level,
        e.logger,
        e.thread,
        e.message,
        e.traceId,
        e.source,
      ]);
      if (!seen.has(key)) {
        seen.add(key);
        fresh.push(e);

        // Prevent unbounded growth of seen Set (memory leak prevention)
        if (seen.size > NetworkService.MAX_SEEN_ENTRIES) {
          // Remove oldest entries by converting to array, slicing, and recreating
          // This keeps the most recent entries which are more likely to be duplicates
          const recentEntries = Array.from(seen).slice(
            -NetworkService.MAX_SEEN_ENTRIES / 2,
          );
          seen.clear();
          recentEntries.forEach((k) => seen.add(k));
          log.debug(
            `[http:poll] Trimmed seen Set to ${seen.size} entries (was ${seen.size + fresh.length})`,
          );
        }
      }
    }
    return fresh;
  }

  /**
   * Load logs from HTTP URL once
   */
  async httpLoadOnce(
    url: string,
  ): Promise<{ ok: boolean; entries?: LogEntry[]; error?: string }> {
    try {
      if (!this.parseJsonFile || !this.parseTextLines) {
        throw new Error("Parser functions not set");
      }

      const text = await this.httpFetchText(url);
      const isJson = text.trim().startsWith("[") || text.trim().startsWith("{");
      const entries = isJson
        ? this.parseJsonFile(url, text)
        : this.parseTextLines(url, text);

      return { ok: true, entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("HTTP load failed:", message);
      return { ok: false, error: message };
    }
  }

  /**
   * Start HTTP polling
   * @param url - URL to poll
   * @param intervalSec - Polling interval in seconds (minimum 1 second)
   */
  async httpStartPoll(
    url: string,
    intervalSec: number,
  ): Promise<{ ok: boolean; id?: number; error?: string }> {
    // Convert seconds to milliseconds, minimum 1 second (1000ms)
    const intervalMs = Math.max(1, intervalSec) * 1000;

    log.info(
      `[http:poll] httpStartPoll called for url=${url}, intervalSec=${intervalSec} (${intervalMs}ms), current pollers: ${Array.from(this.httpPollers.keys()).join(", ") || "none"}`,
    );

    try {
      if (!this.parseJsonFile || !this.parseTextLines || !this.toEntry) {
        throw new Error("Parser functions not set");
      }

      // noop await to satisfy require-await without side effects
      await Promise.resolve();

      const id = this.httpPollerSeq++;
      const seen = new Set<string>();
      const abortController = new AbortController();

      const parseJsonFile = this.parseJsonFile;
      const parseTextLines = this.parseTextLines;

      // Helper to yield to event loop - prevents UI freeze ("Keine Rückmeldung")
      const yieldToEventLoop = (): Promise<void> =>
        new Promise((resolve) => setImmediate(resolve));

      // Helper to check if poller is still active (not stopped)
      const isPollerActive = (): boolean => {
        const poller = this.httpPollers.get(id);
        return poller != null && !poller.stopped;
      };

      const tick = async (): Promise<void> => {
        // Early exit if poller was stopped
        if (!isPollerActive()) {
          log.debug(
            `[http:poll] ${id} tick skipped - poller not active (stopped or removed from map)`,
          );
          return;
        }

        log.debug(`[http:poll] ${id} tick starting for ${url}`);

        try {
          const text = await this.httpFetchText(url, abortController.signal);

          // Check again after fetch (which could take a while)
          if (!isPollerActive()) {
            log.debug(
              `[http:poll] ${id} processing skipped - poller stopped during fetch`,
            );
            return;
          }

          const isJson =
            text.trim().startsWith("[") || text.trim().startsWith("{");

          // Yield before parsing to let event loop process other tasks
          await yieldToEventLoop();

          // Check before parsing
          if (!isPollerActive()) {
            return;
          }

          const entries = isJson
            ? parseJsonFile(url, text)
            : parseTextLines(url, text);

          // Yield after parsing
          await yieldToEventLoop();

          // Check after parsing
          if (!isPollerActive()) {
            return;
          }

          const fresh = this.dedupeNewEntries(entries, seen);
          if (fresh.length) {
            // For large batches, chunk the queuing to prevent blocking
            if (fresh.length > 200) {
              const chunkSize = 100;
              for (let i = 0; i < fresh.length; i += chunkSize) {
                // Check before each chunk
                if (!isPollerActive()) {
                  return;
                }
                const chunk = fresh.slice(i, i + chunkSize);
                this.queueHttpEntries(chunk);
                // Yield between chunks to keep UI responsive
                await yieldToEventLoop();
              }
            } else {
              this.queueHttpEntries(fresh);
            }
          }
        } catch (err) {
          // Don't log/retry if poller was stopped (abort error)
          if (!isPollerActive()) {
            log.debug(`[http:poll] ${id} error ignored - poller stopped`);
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          // Skip logging for abort errors (poller stopped)
          if (message.includes("aborted") || message.includes("poll stopped")) {
            log.debug(`[http:poll] ${id} aborted: ${message}`);
            return;
          }
          // Keine Log-Einträge in die UI pushen – stilles Retry im nächsten Intervall
          log.warn(`[http:poll] ${url} failed: ${message} (will retry)`);
        } finally {
          // Schedule next tick AFTER current one completes (prevents overlap)
          scheduleNextTick();
        }
      };

      // Schedule next tick using setTimeout (waits for previous tick to complete)
      const scheduleNextTick = (): void => {
        // Don't schedule if poller was stopped
        if (!isPollerActive()) {
          log.debug(
            `[http:poll] ${id} not scheduling next tick - poller stopped`,
          );
          return;
        }

        const timer = setTimeout(() => {
          void tick();
        }, intervalMs);

        // Update the timer reference in the poller config
        const poller = this.httpPollers.get(id);
        if (poller) {
          poller.timer = timer;
        }
      };

      // Create initial poller config (timer will be set by scheduleNextTick)
      const initialTimer = setTimeout(() => {}, 0); // Placeholder, cleared immediately
      clearTimeout(initialTimer);

      this.httpPollers.set(id, {
        id,
        url,
        intervalSec,
        timer: initialTimer,
        seen,
        abortController,
        stopped: false,
      });

      // Fire first tick immediately (it will schedule the next one when done)
      void tick();
      log.info(`HTTP poller ${id} started for ${url} every ${intervalSec}s`);
      return { ok: true, id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("HTTP start poll failed:", message);
      return { ok: false, error: message };
    }
  }

  /**
   * Stop HTTP polling
   */
  httpStopPoll(id: number): { ok: boolean; error?: string } {
    log.info(
      `[http:poll] httpStopPoll called for id=${id}, current pollers: ${Array.from(this.httpPollers.keys()).join(", ")}`,
    );

    const poller = this.httpPollers.get(id);
    if (!poller) {
      log.warn(`[http:poll] httpStopPoll: Poller ${id} not found in map`);
      return { ok: false, error: "Poller not found" };
    }

    // Flush any pending batched entries before stopping
    this.flushHttpBatch();

    log.info(
      `[http:poll] Stopping poller ${id}: setting stopped=true, aborting fetch, clearing timer`,
    );

    // Mark as stopped first to prevent new ticks
    poller.stopped = true;

    // Abort any pending fetch requests
    poller.abortController.abort();

    // Clear the timeout timer
    clearTimeout(poller.timer);

    // Remove from map
    this.httpPollers.delete(id);

    log.info(
      `HTTP poller ${id} stopped, remaining pollers: ${Array.from(this.httpPollers.keys()).join(", ") || "none"}`,
    );

    return { ok: true };
  }

  /**
   * Stop all HTTP pollers
   */
  stopAllHttpPollers(): void {
    // Flush any pending batched entries before stopping
    this.flushHttpBatch();

    for (const poller of this.httpPollers.values()) {
      // Mark as stopped first to prevent new ticks
      poller.stopped = true;
      // Abort any pending fetch requests
      poller.abortController.abort();
      // Clear the timeout timer
      clearTimeout(poller.timer);
    }
    this.httpPollers.clear();
    log.info("All HTTP pollers stopped");
  }

  /**
   * Cleanup - stop all services
   */
  cleanup(): void {
    this.stopAllHttpPollers();
    if (this.tcpServer) {
      void this.stopTcpServer();
    }
  }

  /**
   * Get diagnostic information about resource usage
   */
  getDiagnostics(): {
    tcp: {
      running: boolean;
      port?: number;
      activeConnections: number;
      maxConnections: number;
      connectionLimit: number;
    };
    http: {
      activePollers: number;
      pollerDetails: Array<{
        id: number;
        url: string;
        intervalSec: number;
        seenEntries: number;
      }>;
      fetchTimeoutMs: number;
      maxResponseSize: number;
    };
    limits: {
      tcpMaxConnections: number;
      tcpBufferSize: number;
      tcpTimeout: number;
      httpTimeout: number;
      httpMaxResponseSize: number;
      maxSeenEntries: number;
    };
  } {
    return {
      tcp: {
        running: this.tcpRunning,
        port: this.tcpPort || undefined,
        activeConnections: this.activeSockets.size,
        maxConnections: NetworkService.TCP_MAX_CONNECTIONS,
        connectionLimit: NetworkService.TCP_MAX_CONNECTIONS,
      },
      http: {
        activePollers: this.httpPollers.size,
        pollerDetails: Array.from(this.httpPollers.values()).map((p) => ({
          id: p.id,
          url: p.url,
          intervalSec: p.intervalSec,
          seenEntries: p.seen.size,
        })),
        fetchTimeoutMs: NetworkService.HTTP_FETCH_TIMEOUT_MS,
        maxResponseSize: NetworkService.HTTP_MAX_RESPONSE_SIZE,
      },
      limits: {
        tcpMaxConnections: NetworkService.TCP_MAX_CONNECTIONS,
        tcpBufferSize: NetworkService.MAX_BUFFER_SIZE,
        tcpTimeout: NetworkService.SOCKET_TIMEOUT_MS,
        httpTimeout: NetworkService.HTTP_FETCH_TIMEOUT_MS,
        httpMaxResponseSize: NetworkService.HTTP_MAX_RESPONSE_SIZE,
        maxSeenEntries: NetworkService.MAX_SEEN_ENTRIES,
      },
    };
  }
}
