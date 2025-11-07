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
  intervalMs: number;
  timer: NodeJS.Timeout;
  seen: Set<string>;
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
  private static readonly MAX_BUFFER_SIZE = 1024 * 1024; // 1MB max buffer per socket
  private static readonly SOCKET_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout
  private static readonly MAX_LINE_LENGTH = 100 * 1024; // 100KB max line length

  // Track active sockets for monitoring
  private activeSockets = new Set<net.Socket>();

  /**
   * Set the log callback function
   */
  setLogCallback(callback: LogCallback): void {
    this.logCallback = callback;
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
      let buffer = "";
      const remoteAddr = socket.remoteAddress ?? "unknown";
      const remotePort = socket.remotePort ?? 0;
      const socketId = `${remoteAddr}:${remotePort}`;

      // Track socket for monitoring
      this.activeSockets.add(socket);
      log.debug(`[tcp] Socket connected: ${socketId} (active: ${this.activeSockets.size})`);

      // Set socket timeout to prevent hanging connections
      socket.setTimeout(NetworkService.SOCKET_TIMEOUT_MS);

      // Cleanup function to be called on socket end/close
      const cleanup = (): void => {
        if (this.activeSockets.has(socket)) {
          this.activeSockets.delete(socket);
          log.debug(`[tcp] Socket cleaned up: ${socketId} (active: ${this.activeSockets.size})`);
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
            buffer = buffer.slice(buffer.length - NetworkService.MAX_BUFFER_SIZE / 2);
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
            this.sendLogs([entry]);
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
        const actualPort = address && typeof address === "object" ? address.port : port;
        
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
   * Fetch text from HTTP URL
   */
  private async httpFetchText(url: string): Promise<string> {
    if (typeof fetch === "function") {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      return await res.text();
    }
    throw new Error("fetch unavailable");
  }

  /**
   * Deduplicate new entries based on key fields
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
   */
  async httpStartPoll(
    url: string,
    intervalMs: number,
  ): Promise<{ ok: boolean; id?: number; error?: string }> {
    try {
      if (!this.parseJsonFile || !this.parseTextLines || !this.toEntry) {
        throw new Error("Parser functions not set");
      }

      // noop await to satisfy require-await without side effects
      await Promise.resolve();

      const id = this.httpPollerSeq++;
      const seen = new Set<string>();

      const parseJsonFile = this.parseJsonFile;
      const parseTextLines = this.parseTextLines;

      const tick = async (): Promise<void> => {
        try {
          const text = await this.httpFetchText(url);
          const isJson =
            text.trim().startsWith("[") || text.trim().startsWith("{");
          const entries = isJson
            ? parseJsonFile(url, text)
            : parseTextLines(url, text);
          const fresh = this.dedupeNewEntries(entries, seen);
          if (fresh.length) {
            this.sendLogs(fresh);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Keine Log-Einträge in die UI pushen – stilles Retry im nächsten Intervall
          log.warn(`[http:poll] ${url} failed: ${message} (will retry)`);
        }
      };

      const timer = setInterval(
        () => {
          void tick();
        },
        Math.max(500, intervalMs),
      );

      this.httpPollers.set(id, { id, url, intervalMs, timer, seen });

      // Fire once immediately
      void tick();
      log.info(`HTTP poller ${id} started for ${url} every ${intervalMs} ms`);
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
    const poller = this.httpPollers.get(id);
    if (!poller) {
      return { ok: false, error: "Poller not found" };
    }

    clearInterval(poller.timer);
    this.httpPollers.delete(id);
    log.info(`HTTP poller ${id} stopped`);

    return { ok: true };
  }

  /**
   * Stop all HTTP pollers
   */
  stopAllHttpPollers(): void {
    for (const poller of this.httpPollers.values()) {
      clearInterval(poller.timer);
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
    };
    http: {
      activePollers: number;
      pollerDetails: Array<{ id: number; url: string; intervalMs: number }>;
    };
  } {
    return {
      tcp: {
        running: this.tcpRunning,
        port: this.tcpPort || undefined,
        activeConnections: this.activeSockets.size,
      },
      http: {
        activePollers: this.httpPollers.size,
        pollerDetails: Array.from(this.httpPollers.values()).map((p) => ({
          id: p.id,
          url: p.url,
          intervalMs: p.intervalMs,
        })),
      },
    };
  }
}
