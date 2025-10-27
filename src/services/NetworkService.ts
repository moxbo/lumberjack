/**
 * NetworkService
 * Manages TCP server and HTTP polling operations
 */

import * as net from 'net';
import log from 'electron-log/main';
import type { LogEntry } from '../types/ipc';

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
  source: string
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
        message: 'TCP server already running',
        running: true,
        port: this.tcpPort,
      });
    }

    if (!this.toEntry) {
      return Promise.resolve({
        ok: false,
        message: 'Parser functions not set',
        running: false,
      });
    }

    const toEntry = this.toEntry;

    const server = net.createServer((socket) => {
      let buffer = '';

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let idx: number;

        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          if (!line) continue;

          // Parse JSON line, fallback to plain text
          let obj: Record<string, unknown>;
          try {
            obj = JSON.parse(line) as Record<string, unknown>;
          } catch (e) {
            log.warn(
              'TCP JSON parse failed, treating as plain text:',
              e instanceof Error ? e.message : String(e)
            );
            obj = { message: line };
          }

          const entry = toEntry(
            obj,
            '',
            `tcp:${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`
          );
          this.sendLogs([entry]);
        }
      });

      socket.on('error', (err) => {
        const errorEntry = toEntry(
          { level: 'ERROR', message: `TCP socket error: ${err.message}` },
          '',
          'tcp'
        );
        this.sendLogs([errorEntry]);
      });
    });

    this.tcpServer = server;

    return new Promise<TcpStatus>((resolve) => {
      const onError = (err: Error): void => {
        log.error('TCP server error during startup:', err);
        // Cleanup server so we don't appear as running on next start
        try {
          server.removeListener('listening', onListening);
        } catch (e) {
          log.warn(
            'Removing listening listener failed:',
            e instanceof Error ? e.message : String(e)
          );
        }
        try {
          server.close();
        } catch (e) {
          log.warn(
            'Closing TCP server after error failed:',
            e instanceof Error ? e.message : String(e)
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
          server.removeListener('error', onError);
        } catch (e) {
          log.warn('Removing error listener failed:', e instanceof Error ? e.message : String(e));
        }
        this.tcpRunning = true;
        this.tcpPort = port;
        log.info(`TCP server listening on port ${port}`);
        // Attach a general error logger for runtime errors (does not change running state)
        server.on('error', (err) => {
          log.error('TCP server runtime error:', err);
        });
        resolve({
          ok: true,
          message: `Listening on ${port}`,
          running: true,
          port,
        });
      };

      server.once('error', onError);
      server.once('listening', onListening);

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
        message: 'TCP server not running',
        running: false,
      });
    }

    return new Promise<TcpStatus>((resolve) => {
      this.tcpServer!.close(() => {
        this.tcpServer = null;
        this.tcpRunning = false;
        this.tcpPort = 0;
        log.info('TCP server stopped');
        resolve({
          ok: true,
          message: 'TCP server stopped',
          running: false,
        });
      });
    });
  }

  /**
   * Get TCP server status
   */
  getTcpStatus(): TcpStatus {
    return {
      ok: true,
      message: this.tcpRunning ? `Running on port ${this.tcpPort}` : 'Not running',
      running: this.tcpRunning,
      port: this.tcpRunning ? this.tcpPort : undefined,
    };
  }

  /**
   * Fetch text from HTTP URL
   */
  private async httpFetchText(url: string): Promise<string> {
    if (typeof fetch === 'function') {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      return await res.text();
    }
    throw new Error('fetch unavailable');
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
  async httpLoadOnce(url: string): Promise<{ ok: boolean; entries?: LogEntry[]; error?: string }> {
    try {
      if (!this.parseJsonFile || !this.parseTextLines) {
        throw new Error('Parser functions not set');
      }

      const text = await this.httpFetchText(url);
      const isJson = text.trim().startsWith('[') || text.trim().startsWith('{');
      const entries = isJson ? this.parseJsonFile(url, text) : this.parseTextLines(url, text);

      return { ok: true, entries };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('HTTP load failed:', message);
      return { ok: false, error: message };
    }
  }

  /**
   * Start HTTP polling
   */
  async httpStartPoll(
    url: string,
    intervalMs: number
  ): Promise<{ ok: boolean; id?: number; error?: string }> {
    try {
      if (!this.parseJsonFile || !this.parseTextLines || !this.toEntry) {
        throw new Error('Parser functions not set');
      }

      const id = this.httpPollerSeq++;
      const seen = new Set<string>();

      const parseJsonFile = this.parseJsonFile;
      const parseTextLines = this.parseTextLines;
      const toEntry = this.toEntry;

      const tick = async (): Promise<void> => {
        try {
          const text = await this.httpFetchText(url);
          const isJson = text.trim().startsWith('[') || text.trim().startsWith('{');
          const entries = isJson ? parseJsonFile(url, text) : parseTextLines(url, text);
          const fresh = this.dedupeNewEntries(entries, seen);
          if (fresh.length) {
            this.sendLogs(fresh);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const errorEntry = toEntry(
            { level: 'ERROR', message: `HTTP poll error for ${url}: ${message}` },
            '',
            url
          );
          this.sendLogs([errorEntry]);
        }
      };

      const timer = setInterval(
        () => {
          void tick();
        },
        Math.max(500, intervalMs)
      );

      this.httpPollers.set(id, { id, url, intervalMs, timer, seen });

      // Fire once immediately
      void tick();

      return { ok: true, id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('HTTP start poll failed:', message);
      return { ok: false, error: message };
    }
  }

  /**
   * Stop HTTP polling
   */
  httpStopPoll(id: number): { ok: boolean; error?: string } {
    const poller = this.httpPollers.get(id);
    if (!poller) {
      return { ok: false, error: 'Poller not found' };
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
    log.info('All HTTP pollers stopped');
  }

  /**
   * Cleanup - stop all services
   */
  cleanup(): void {
    this.stopAllHttpPollers();
    if (this.tcpServer) {
      this.stopTcpServer();
    }
  }
}
