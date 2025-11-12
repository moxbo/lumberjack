/**
 * ShutdownCoordinator
 * Coordinates graceful shutdown of all services
 * Ensures proper cleanup with timeout protection
 */

import log from "electron-log/main";

interface ShutdownHandler {
  name: string;
  handler: () => Promise<void>;
}

/**
 * ShutdownCoordinator manages graceful application shutdown
 */
export class ShutdownCoordinator {
  private handlers: ShutdownHandler[] = [];
  private readonly shutdownTimeout: number;
  private isShuttingDown = false;

  constructor(shutdownTimeout: number = 10000) {
    this.shutdownTimeout = shutdownTimeout;
  }

  /**
   * Register a shutdown handler
   */
  register(name: string, handler: () => Promise<void>): void {
    this.handlers.push({ name, handler });
    log.info(`[shutdown] Registered handler: ${name}`);
  }

  /**
   * Execute all shutdown handlers
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      log.warn("[shutdown] Already shutting down");
      return;
    }

    this.isShuttingDown = true;
    log.info("[shutdown] Starting graceful shutdown...");

    try {
      await Promise.race([
        this.executeHandlers(),
        new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error("Shutdown timeout")),
            this.shutdownTimeout,
          ),
        ),
      ]);

      log.info("[shutdown] Graceful shutdown completed");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error("[shutdown] Forced shutdown after timeout:", err.message);
    } finally {
      this.isShuttingDown = false;
    }
  }

  /**
   * Execute all registered handlers
   */
  private async executeHandlers(): Promise<void> {
    for (const { name, handler } of this.handlers) {
      try {
        log.info(`[shutdown] Executing: ${name}...`);
        await handler();
        log.info(`[shutdown] Completed: ${name}`);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        log.error(`[shutdown] Failed: ${name}`, err.message);
        // Continue with other handlers even if one fails
      }
    }
  }

  /**
   * Check if shutdown is in progress
   */
  isInProgress(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get registered handler names
   */
  getHandlers(): string[] {
    return this.handlers.map((h) => h.name);
  }

  /**
   * Clear all registered handlers
   */
  clear(): void {
    this.handlers = [];
    log.info("[shutdown] All handlers cleared");
  }
}
