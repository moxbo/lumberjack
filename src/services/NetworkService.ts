/**
 * NetworkService
 * Manages TCP server and HTTP polling operations
 */

import * as net from "net";
import * as https from "https";
import { createHash } from "crypto";
import log from "electron-log/main";
import type { LogEntry } from "../types/ipc";
import { responseChunks } from "./ResponseStream";
import { StringDecoder } from "string_decoder";

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
export type LogCallback = (entries: LogEntry[]) => unknown;

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
  private tcpStopPromise: Promise<TcpStatus> | null = null;
  private tcpRunning = false;
  private tcpPort = 0;
  private httpPollers = new Map<number, HttpPollConfig>();
  private httpPollerSeq = 1;
  private logCallback: LogCallback | null = null;
  private parseJsonFile: JsonParserFn | null = null;
  private parseTextLines: TextParserFn | null = null;
  private toEntry: EntryConverterFn | null = null;

  // SSL/TLS options
  private allowInsecureSSL = false;
  private insecureHttpsAgent: https.Agent | null = null;

  // Memory leak prevention constants
  private static readonly MAX_BUFFER_SIZE = 2 * 1024 * 1024;
  private static readonly SOCKET_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout
  private static readonly TCP_SHUTDOWN_GRACE_MS = 1000;
  private static readonly MAX_LINE_LENGTH = 1024 * 1024;
  private static readonly MAX_SEEN_ENTRIES = 10000; // Max deduplication entries per poller

  // Additional robustness constants
  private static readonly HTTP_FETCH_TIMEOUT_MS = 30 * 1000; // 30 seconds HTTP timeout
  private static readonly HTTP_MAX_RESPONSE_SIZE = 16 * 1024 * 1024;
  private static readonly TCP_MAX_CONNECTIONS = 16;
  private static readonly HTTP_MAX_POLLERS = 4;
  private httpFetches = 0;
  private tcpDeliveries = new Set<Promise<void>>();
  private logDeliveries = new Set<Promise<unknown>>();

  // Track active sockets for monitoring
  private activeSockets = new Set<net.Socket>();

  // Each socket holds at most one bounded parsed batch while awaiting persistence.
  private static readonly TCP_BATCH_SIZE = 500; // Max entries per batch
  private static readonly HTTP_BATCH_SIZE = 100; // Max entries per batch (reduced from 500)

  /**
   * Set the log callback function
   */
  setLogCallback(callback: LogCallback): void {
    this.logCallback = callback;
  }

  /**
   * Enable or disable insecure SSL/TLS connections
   * When enabled, self-signed certificates and certificate errors are ignored
   * WARNING: Only use for development/testing, not in production!
   */
  setAllowInsecureSSL(allow: boolean): void {
    this.allowInsecureSSL = allow;
    if (allow && !this.insecureHttpsAgent) {
      this.insecureHttpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
      log.warn(
        "[http] Insecure SSL mode enabled - certificate validation disabled",
      );
    } else if (!allow) {
      this.insecureHttpsAgent = null;
      log.info("[http] Insecure SSL mode disabled");
    }
  }

  /**
   * Get current insecure SSL setting
   */
  getAllowInsecureSSL(): boolean {
    return this.allowInsecureSSL;
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
  private async sendLogs(entries: LogEntry[]): Promise<void> {
    if (this.logCallback && entries.length > 0) {
      let timer!: ReturnType<typeof setTimeout>;
      const delivery = Promise.race([
        Promise.resolve().then(() => this.logCallback!(entries)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Log persistence acknowledgement timed out")),
            30_000,
          );
        }),
      ]);
      this.logDeliveries.add(delivery);
      try {
        await delivery;
      } finally {
        clearTimeout(timer);
        this.logDeliveries.delete(delivery);
      }
    } else if (entries.length) {
      throw new Error("No log consumer available");
    }
  }

  async waitForPendingLogs(): Promise<void> {
    while (this.logDeliveries.size) {
      await Promise.allSettled(this.logDeliveries);
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

      socket.setEncoding("utf8");
      let processing: Promise<void> | null = null;
      let closed = false;
      let failed = false;
      const processLine = (rawLine: string): LogEntry | undefined => {
        const line = rawLine.trim();
        if (!line) return;

        if (Buffer.byteLength(line, "utf8") > NetworkService.MAX_LINE_LENGTH) {
          throw new Error(
            "TCP line exceeds 1 MiB; connection terminated without delivery acknowledgement",
          );
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

        return toEntry(obj, "", `tcp:${remoteAddr}:${remotePort}`);
      };

      const pump = (): void => {
        if (processing || failed) return;
        socket.pause();
        const delivery = Promise.resolve()
          .then(async () => {
            while (!failed) {
              const batch: LogEntry[] = [];
              let bytes = 0;
              let idx: number;
              while (
                batch.length < NetworkService.TCP_BATCH_SIZE &&
                bytes < 1024 * 1024 &&
                (idx = buffer.indexOf("\n")) >= 0
              ) {
                const line = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 1);
                bytes += Buffer.byteLength(line, "utf8");
                const entry = processLine(line);
                if (entry) batch.push(entry);
              }
              if (
                closed &&
                buffer.length &&
                buffer.indexOf("\n") < 0 &&
                bytes < 1024 * 1024
              ) {
                const entry = processLine(buffer);
                buffer = "";
                if (entry) batch.push(entry);
              }
              if (batch.length) await this.sendLogs(batch);
              if (buffer.indexOf("\n") < 0 && (!closed || !buffer.length))
                break;
            }
          })
          .catch((error: unknown) => {
            failed = true;
            buffer = "";
            log.error(
              `[tcp] Delivery failed on ${socketId}; connection terminated:`,
              error,
            );
            socket.destroy(
              error instanceof Error ? error : new Error(String(error)),
            );
          })
          .finally(() => {
            processing = null;
            this.tcpDeliveries.delete(delivery);
            if (!closed && !failed) socket.resume();
            else if (!failed && buffer.length) pump();
            else if (closed) this.activeSockets.delete(socket);
          });
        processing = delivery;
        this.tcpDeliveries.add(delivery);
      };

      socket.on("data", (chunk: string) => {
        buffer += chunk;
        if (
          Buffer.byteLength(buffer, "utf8") > NetworkService.MAX_BUFFER_SIZE
        ) {
          failed = true;
          buffer = "";
          socket.destroy(
            new Error("TCP buffer capacity exceeded; connection terminated"),
          );
          return;
        }
        pump();
      });

      socket.on("error", (err) => {
        // Only log internally, don't send to UI log list - these are internal socket errors
        // (like ECONNRESET when client disconnects), not actual application log data
        log.warn(`[tcp] Socket error on ${socketId}:`, err.message);
      });

      socket.on("timeout", () => {
        log.warn(`[tcp] Socket timeout on ${socketId}, closing connection`);
        socket.destroy(new Error("TCP socket timed out"));
      });

      socket.on("close", (hadError) => {
        log.debug(
          `[tcp] Socket closed: ${socketId}${hadError ? " (with error)" : ""}`,
        );
        closed = true;
        pump();
        if (failed && !processing) this.activeSockets.delete(socket);
      });

      socket.on("end", () => {
        log.debug(`[tcp] Socket ended: ${socketId}`);
        closed = true;
        pump();
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
    if (this.tcpStopPromise) return this.tcpStopPromise;
    if (!this.tcpServer) {
      return Promise.resolve({
        ok: false,
        message: "TCP server not running",
        running: false,
      });
    }

    this.tcpStopPromise = this.closeTcpServer(this.tcpServer).finally(() => {
      this.tcpStopPromise = null;
    });
    return this.tcpStopPromise;
  }

  private async closeTcpServer(server: net.Server): Promise<TcpStatus> {
    const sockets = Array.from(this.activeSockets);
    const socketsClosed = sockets.map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket.closed) resolve();
          else socket.once("close", () => resolve());
        }),
    );
    log.info(
      `[tcp] Stopping server, closing ${sockets.length} active socket(s)`,
    );

    // A half-open peer can ignore our FIN indefinitely. Keep graceful shutdown
    // first, but force-close remaining sockets after a bounded grace period.
    const timer = setTimeout(() => {
      for (const socket of sockets) {
        if (!socket.closed) socket.destroy();
      }
    }, NetworkService.TCP_SHUTDOWN_GRACE_MS);
    timer.unref();
    try {
      const serverClosed = new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      for (const socket of sockets) {
        try {
          socket.end();
        } catch (error) {
          log.warn("Error ending TCP socket:", error);
          socket.destroy();
        }
      }
      // server.close may fire before socket close callbacks. Those callbacks
      // parse and emit trailing lines, so consumers must wait for both.
      await Promise.all([serverClosed, ...socketsClosed]);
      // Includes trailing-line delivery and its awaited file persistence.
      while (this.tcpDeliveries.size) await Promise.all(this.tcpDeliveries);
      this.tcpServer = null;
      this.tcpRunning = false;
      this.tcpPort = 0;
      log.info("TCP server stopped");
      return { ok: true, message: "TCP server stopped", running: false };
    } finally {
      clearTimeout(timer);
    }
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
   * Fetch HTTPS URL using native Node.js https module with insecure SSL option
   * This allows self-signed certificates and other certificate errors
   */
  private fetchWithNodeHttps(
    _url: string,
    parsedUrl: URL,
    signal: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("Request aborted"));
        return;
      }

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        rejectUnauthorized: false, // Skip certificate validation
        headers: {
          "Cache-Control": "no-store",
        },
      };

      const req = https.request(options, (res) => {
        // Check HTTP status
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        let data = "";
        let bytes = 0;
        res.setEncoding("utf8");

        res.on("data", (chunk: string) => {
          data += chunk;
          bytes += Buffer.byteLength(chunk, "utf8");
          // Check size limit during download
          if (bytes > NetworkService.HTTP_MAX_RESPONSE_SIZE) {
            req.destroy();
            reject(
              new Error(
                `Response too large (max: ${NetworkService.HTTP_MAX_RESPONSE_SIZE})`,
              ),
            );
          }
        });

        res.on("end", () => {
          resolve(data);
        });

        res.on("error", (err) => {
          reject(err);
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      // Handle abort signal
      const onAbort = (): void => {
        req.destroy();
        reject(new Error("Request aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      req.once("close", () => signal.removeEventListener("abort", onAbort));

      req.end();
    });
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
    const release = this.reserveHttpRequest();
    try {
      return await this.fetchText(url, externalSignal);
    } finally {
      release();
    }
  }

  private reserveHttpRequest(): () => void {
    if (this.httpFetches >= NetworkService.HTTP_MAX_POLLERS) {
      throw new Error(
        "HTTP admission capacity exceeded; retry after pending requests",
      );
    }
    this.httpFetches++;
    return () => {
      this.httpFetches--;
    };
  }

  private async fetchText(
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
        // Validate URL before attempting fetch
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
          if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            throw new Error(
              `Invalid protocol: ${parsedUrl.protocol} (must be http: or https:)`,
            );
          }
        } catch (urlErr) {
          if (urlErr instanceof Error && urlErr.message.includes("protocol")) {
            throw urlErr;
          }
          throw new Error(`Invalid URL: ${url}`, { cause: urlErr });
        }

        // For HTTPS with insecure SSL option, use native Node.js https module
        if (this.allowInsecureSSL && parsedUrl.protocol === "https:") {
          const text = await this.fetchWithNodeHttps(
            url,
            parsedUrl,
            controller.signal,
          );
          return text;
        }

        const res = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          await res.body?.cancel();
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        // Check Content-Length header if available
        const contentLength = res.headers.get("content-length");
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (size > NetworkService.HTTP_MAX_RESPONSE_SIZE) {
            await res.body?.cancel();
            throw new Error(
              `Response too large: ${size} bytes (max: ${NetworkService.HTTP_MAX_RESPONSE_SIZE})`,
            );
          }
        }

        const decoder = new StringDecoder("utf8");
        let text = "";
        let bytes = 0;
        for await (const chunk of responseChunks(
          res,
          NetworkService.HTTP_FETCH_TIMEOUT_MS,
          controller.signal,
        )) {
          bytes += chunk.byteLength;
          if (bytes > NetworkService.HTTP_MAX_RESPONSE_SIZE) {
            throw new Error(
              `Response too large (max: ${NetworkService.HTTP_MAX_RESPONSE_SIZE})`,
            );
          }
          text += decoder.write(Buffer.from(chunk));
        }
        return text + decoder.end();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Check if it was external abort (poll stopped) vs timeout
          if (externalSignal?.aborted) {
            throw new Error("Request aborted (poll stopped)", { cause: err });
          }
          throw new Error(
            `Request timeout after ${NetworkService.HTTP_FETCH_TIMEOUT_MS}ms`,
            { cause: err },
          );
        }
        // Provide more helpful error messages for common network errors
        if (err instanceof Error) {
          const errMsg = err.message.toLowerCase();
          if (errMsg.includes("enotfound") || errMsg.includes("getaddrinfo")) {
            throw new Error(`DNS lookup failed: Host not found for ${url}`, {
              cause: err,
            });
          }
          if (errMsg.includes("econnrefused")) {
            throw new Error(
              `Connection refused: Server at ${url} is not accepting connections`,
              { cause: err },
            );
          }
          if (errMsg.includes("econnreset")) {
            throw new Error(`Connection reset: Server closed the connection`, {
              cause: err,
            });
          }
          if (errMsg.includes("etimedout") || errMsg.includes("timeout")) {
            throw new Error(`Connection timeout: Could not reach ${url}`, {
              cause: err,
            });
          }
          if (
            errMsg.includes("cert") ||
            errMsg.includes("ssl") ||
            errMsg.includes("tls")
          ) {
            throw new Error(`SSL/TLS error: ${err.message}`, { cause: err });
          }
          if (errMsg.includes("fetch failed")) {
            // Generic fetch error - provide URL for context
            throw new Error(`Network error: Could not connect to ${url}`, {
              cause: err,
            });
          }
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
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            e.timestamp,
            e.level,
            e.logger,
            e.thread,
            e.message,
            e.traceId,
            e.source,
          ]),
        )
        .digest("hex");
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
    consume?: (entries: LogEntry[]) => void | Promise<void>,
  ): Promise<{ ok: boolean; entries?: LogEntry[]; error?: string }> {
    let release: (() => void) | undefined;
    try {
      if (!this.parseJsonFile || !this.parseTextLines) {
        throw new Error("Parser functions not set");
      }

      // Keep admission until persistence ACK: a completed download still retains
      // its bounded response while the consumer is busy.
      release = this.reserveHttpRequest();
      const text = await this.fetchText(url);
      if (consume) {
        const trimmed = text.trimStart();
        let array: unknown[] | undefined;
        if (trimmed.startsWith("[")) {
          try {
            const parsed: unknown = JSON.parse(text);
            if (Array.isArray(parsed)) array = parsed;
          } catch {
            // Match parseJsonFile's fallback to line-oriented parsing.
          }
        }
        if (array) {
          for (
            let i = 0;
            i < array.length;
            i += NetworkService.HTTP_BATCH_SIZE
          ) {
            const batch = this.parseJsonFile(
              url,
              JSON.stringify(
                array.slice(i, i + NetworkService.HTTP_BATCH_SIZE),
              ),
            );
            await consume(batch);
          }
        } else {
          let start = 0;
          let lines = 0;
          for (let i = 0; i < text.length; i++) {
            if (text[i] !== "\n") continue;
            if (++lines < NetworkService.HTTP_BATCH_SIZE) continue;
            const batch = this.parseTextLines(url, text.slice(start, i + 1));
            if (batch.length) await consume(batch);
            start = i + 1;
            lines = 0;
          }
          if (start < text.length) {
            const batch = this.parseTextLines(url, text.slice(start));
            if (batch.length) await consume(batch);
          }
        }
        return { ok: true, entries: [] };
      }
      const isJson = text.trim().startsWith("[") || text.trim().startsWith("{");
      const entries = isJson
        ? this.parseJsonFile(url, text)
        : this.parseTextLines(url, text);

      return { ok: true, entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("HTTP load failed:", message);
      return { ok: false, error: message };
    } finally {
      release?.();
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
    onError?: (id: number, error: Error) => void,
  ): Promise<{ ok: boolean; id?: number; error?: string }> {
    // Convert seconds to milliseconds, minimum 1 second (1000ms)
    const intervalMs = Math.max(1, intervalSec) * 1000;

    log.info(
      `[http:poll] httpStartPoll called for url=${url}, intervalSec=${intervalSec} (${intervalMs}ms), current pollers: ${Array.from(this.httpPollers.keys()).join(", ") || "none"}`,
    );

    try {
      if (this.httpPollers.size >= NetworkService.HTTP_MAX_POLLERS) {
        throw new Error("HTTP poller capacity exceeded");
      }
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

          for (
            let i = 0;
            i < entries.length;
            i += NetworkService.HTTP_BATCH_SIZE
          ) {
            if (!isPollerActive()) return;
            const nextSeen = new Set(seen);
            const fresh = this.dedupeNewEntries(
              entries.slice(i, i + NetworkService.HTTP_BATCH_SIZE),
              nextSeen,
            );
            if (fresh.length) {
              try {
                await this.sendLogs(fresh);
              } catch (error) {
                if (!isPollerActive()) return;
                // Persistence may have accepted a prefix. Never refetch/replay
                // the whole range after an ambiguous or terminal consumer error.
                log.error(
                  `[http:poll] ${url} stopped after delivery failure:`,
                  error,
                );
                this.httpStopPoll(id);
                onError?.(
                  id,
                  error instanceof Error ? error : new Error(String(error)),
                );
                return;
              }
            }
            seen.clear();
            for (const key of nextSeen) seen.add(key);
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
