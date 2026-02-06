/**
 * Filter Service
 *
 * Verwaltet den UtilityProcess für CPU-intensive Filter-Operationen.
 * Electron 40+ Feature für bessere Performance und Memory-Isolation.
 */

import { utilityProcess, UtilityProcess } from "electron";
import * as path from "path";
import log from "electron-log/main";

// ============================================================================
// Types
// ============================================================================

interface FilterOptions {
  stdFiltersEnabled: boolean;
  filter: {
    level: string;
    logger: string;
    thread: string;
    message: string;
  };
  onlyMarked: boolean;
  dcFilterEnabled: boolean;
  dcFilterEntries: Array<{ key: string; value: string; active: boolean }>;
  timeFilterEnabled: boolean;
  timeFilterFrom?: string;
  timeFilterTo?: string;
}

interface FilterStats {
  total: number;
  passed: number;
  rejectedByOnlyMarked: number;
  rejectedByLevel: number;
  rejectedByLogger: number;
  rejectedByThread: number;
  rejectedByMessage: number;
  rejectedByTime: number;
  rejectedByDC: number;
  processingTimeMs?: number;
}

interface FilterResult {
  filteredIndices: number[];
  stats: FilterStats;
}

interface PendingRequest {
  resolve: (result: FilterResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// ============================================================================
// Filter Service
// ============================================================================

/**
 * FilterService - Singleton für UtilityProcess-basiertes Filtering
 *
 * Features:
 * - Lazy initialization des UtilityProcess
 * - Automatisches Restart bei Crashes
 * - Request-Queuing mit Timeouts
 * - Fallback auf synchrones Filtering bei Fehlern
 */
class FilterService {
  private process: UtilityProcess | null = null;
  private ready = false;
  private pendingRequests = new Map<number, PendingRequest>();
  private requestCounter = 0;
  private restartAttempts = 0;
  private readonly maxRestartAttempts = 3;
  private readonly requestTimeoutMs = 30000; // 30 Sekunden Timeout

  /**
   * Startet den Filter-UtilityProcess
   */
  private async startProcess(): Promise<void> {
    if (this.process) {
      return;
    }

    try {
      // Pfad zum kompilierten Filter-Prozess
      const filterProcessPath = this.resolveFilterProcessPath();

      log.info("[FilterService] Starting utility process:", filterProcessPath);

      this.process = utilityProcess.fork(filterProcessPath, [], {
        serviceName: "lumberjack-filter",
      });

      this.process.on("message", (message: unknown) => {
        this.handleMessage(message);
      });

      this.process.on("exit", (code) => {
        log.warn("[FilterService] Utility process exited with code:", code);
        this.handleProcessExit();
      });

      // Warte auf "ready" Message
      await this.waitForReady();

      log.info("[FilterService] Utility process ready");
      this.restartAttempts = 0;
    } catch (error) {
      log.error("[FilterService] Failed to start utility process:", error);
      this.process = null;
      throw error;
    }
  }

  /**
   * Löst den Pfad zum Filter-Prozess auf
   */
  private resolveFilterProcessPath(): string {
    const candidates = [
      // Development: dist-main
      path.join(__dirname, "filterProcess.cjs"),
      path.join(__dirname, "filterProcess.js"),
      // Production: release/app/dist/main
      path.join(__dirname, "..", "main", "filterProcess.cjs"),
      path.join(__dirname, "..", "main", "filterProcess.js"),
      // Fallback
      path.join(process.cwd(), "dist-main", "filterProcess.cjs"),
    ];

    for (const candidate of candidates) {
      try {
        require.resolve(candidate);
        return candidate;
      } catch {
        // Continue to next candidate
      }
    }

    // Fallback: Verwende __dirname als Basis
    return path.join(__dirname, "filterProcess.cjs");
  }

  /**
   * Wartet darauf, dass der Process "ready" signalisiert
   */
  private waitForReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for filter process to be ready"));
      }, 10000);

      const readyHandler = (message: unknown): void => {
        if (
          message &&
          typeof message === "object" &&
          (message as { type?: string }).type === "ready"
        ) {
          clearTimeout(timeout);
          this.ready = true;
          resolve();
        }
      };

      if (this.process) {
        this.process.on("message", readyHandler);
      } else {
        clearTimeout(timeout);
        reject(new Error("No process available"));
      }
    });
  }

  /**
   * Behandelt eingehende Messages vom UtilityProcess
   */
  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") return;

    const msg = message as {
      type?: string;
      requestId?: number;
      filteredIndices?: number[];
      stats?: FilterStats;
    };

    if (msg.type === "result" && msg.requestId !== undefined) {
      const pending = this.pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(msg.requestId);

        pending.resolve({
          filteredIndices: msg.filteredIndices || [],
          stats: msg.stats || {
            total: 0,
            passed: 0,
            rejectedByOnlyMarked: 0,
            rejectedByLevel: 0,
            rejectedByLogger: 0,
            rejectedByThread: 0,
            rejectedByMessage: 0,
            rejectedByTime: 0,
            rejectedByDC: 0,
          },
        });
      }
    }
  }

  /**
   * Behandelt Process-Exit (Crash oder normales Ende)
   */
  private handleProcessExit(): void {
    this.ready = false;
    this.process = null;

    // Alle pending requests mit Fehler auflösen
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Filter process exited unexpectedly"));
      this.pendingRequests.delete(requestId);
    }

    // Versuche Restart wenn unter Max-Versuchen
    if (this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      log.info(
        `[FilterService] Attempting restart (${this.restartAttempts}/${this.maxRestartAttempts})`,
      );
      // Verzögerter Restart
      setTimeout(() => {
        this.startProcess().catch((err) => {
          log.error("[FilterService] Restart failed:", err);
        });
      }, 1000);
    }
  }

  /**
   * Filtert Entries mit dem UtilityProcess
   */
  async filter(
    entries: unknown[],
    options: FilterOptions,
  ): Promise<FilterResult> {
    // Stelle sicher, dass der Process läuft
    if (!this.process || !this.ready) {
      await this.startProcess();
    }

    if (!this.process) {
      throw new Error("Filter process not available");
    }

    const requestId = ++this.requestCounter;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Filter request timeout"));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      try {
        this.process!.postMessage({
          type: "filter",
          requestId,
          entries,
          options,
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Prüft ob der Service verfügbar ist
   */
  isAvailable(): boolean {
    return this.ready && this.process !== null;
  }

  /**
   * Beendet den UtilityProcess
   */
  shutdown(): void {
    if (this.process) {
      log.info("[FilterService] Shutting down utility process");
      this.process.kill();
      this.process = null;
      this.ready = false;
    }

    // Alle pending requests abbrechen
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Filter service shutdown"));
      this.pendingRequests.delete(requestId);
    }
  }
}

// Singleton-Instanz
let filterServiceInstance: FilterService | null = null;

/**
 * Gibt die Singleton-Instanz des FilterService zurück
 */
export function getFilterService(): FilterService {
  if (!filterServiceInstance) {
    filterServiceInstance = new FilterService();
  }
  return filterServiceInstance;
}

export { FilterService };
export type { FilterOptions, FilterStats, FilterResult };
