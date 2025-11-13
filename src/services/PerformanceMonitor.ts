/**
 * PerformanceMonitor
 * Real-time performance metrics tracking and reporting
 * Monitors memory usage, event loop lag, and system health
 */

import log from "electron-log/main";
import * as os from "os";

export interface PerformanceSnapshot {
  timestamp: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    user: number;
    system: number;
  };
  system: {
    totalMemory: number;
    freeMemory: number;
    cpuUsage: number;
  };
  eventLoop: {
    lag: number;
  };
}

export interface PerformanceStats {
  snapshots: PerformanceSnapshot[];
  averages: {
    memoryHeapUsed: number;
    memoryRSS: number;
    eventLoopLag: number;
  };
}

/**
 * PerformanceMonitor tracks real-time application performance
 */
export class PerformanceMonitor {
  private snapshots: PerformanceSnapshot[] = [];
  private readonly maxSnapshots = 100;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;
  private lastCpuUsage = process.cpuUsage();
  private lastEventLoopCheck = Date.now();

  /**
   * Take a performance snapshot
   */
  async snapshot(): Promise<PerformanceSnapshot> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();

    // Measure event loop lag
    const start = Date.now();
    await new Promise((resolve) => setImmediate(resolve));
    const eventLoopLag = Date.now() - start;

    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      system: {
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        cpuUsage: os.loadavg()[0], // 1-minute load average
      },
      eventLoop: {
        lag: eventLoopLag,
      },
    };

    this.snapshots.push(snapshot);

    // Keep only recent snapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /**
   * Start continuous performance monitoring
   */
  startMonitoring(intervalMs: number = 10000): void {
    if (this.isMonitoring) {
      log.warn("[perf-monitor] Already monitoring");
      return;
    }

    this.isMonitoring = true;

    // Take initial snapshot
    this.snapshot().catch((err) => {
      log.error("[perf-monitor] Initial snapshot failed:", err);
    });

    // Schedule periodic snapshots
    this.monitoringInterval = setInterval(() => {
      this.snapshot().catch((err) => {
        log.error("[perf-monitor] Snapshot failed:", err);
      });
    }, intervalMs);

    log.info(`[perf-monitor] Started monitoring (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop continuous monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;
    log.info("[perf-monitor] Stopped monitoring");
  }

  /**
   * Get performance statistics
   */
  getStats(): PerformanceStats {
    const snapshots = [...this.snapshots];

    const averages = {
      memoryHeapUsed: 0,
      memoryRSS: 0,
      eventLoopLag: 0,
    };

    if (snapshots.length > 0) {
      averages.memoryHeapUsed =
        snapshots.reduce((sum, s) => sum + s.memory.heapUsed, 0) /
        snapshots.length;
      averages.memoryRSS =
        snapshots.reduce((sum, s) => sum + s.memory.rss, 0) / snapshots.length;
      averages.eventLoopLag =
        snapshots.reduce((sum, s) => sum + s.eventLoop.lag, 0) /
        snapshots.length;
    }

    return {
      snapshots,
      averages,
    };
  }

  /**
   * Get latest snapshot
   */
  getLatest(): PerformanceSnapshot | null {
    return this.snapshots.length > 0
      ? this.snapshots[this.snapshots.length - 1]
      : null;
  }

  /**
   * Clear all snapshots
   */
  clear(): void {
    this.snapshots = [];
    log.info("[perf-monitor] Cleared all snapshots");
  }

  /**
   * Log performance summary
   */
  logSummary(): void {
    const stats = this.getStats();
    const latest = this.getLatest();

    log.info("=== Performance Summary ===");
    log.info(`Total snapshots: ${stats.snapshots.length}`);

    if (latest) {
      log.info("Latest metrics:");
      log.info(
        `  Memory heap: ${Math.round(latest.memory.heapUsed / (1024 * 1024))}MB / ${Math.round(latest.memory.heapTotal / (1024 * 1024))}MB`,
      );
      log.info(
        `  Memory RSS: ${Math.round(latest.memory.rss / (1024 * 1024))}MB`,
      );
      log.info(`  Event loop lag: ${latest.eventLoop.lag}ms`);
      log.info(
        `  System memory: ${Math.round((latest.system.totalMemory - latest.system.freeMemory) / (1024 * 1024))}MB / ${Math.round(latest.system.totalMemory / (1024 * 1024))}MB`,
      );
    }

    if (stats.snapshots.length > 1) {
      log.info("Averages:");
      log.info(
        `  Memory heap: ${Math.round(stats.averages.memoryHeapUsed / (1024 * 1024))}MB`,
      );
      log.info(
        `  Memory RSS: ${Math.round(stats.averages.memoryRSS / (1024 * 1024))}MB`,
      );
      log.info(
        `  Event loop lag: ${Math.round(stats.averages.eventLoopLag)}ms`,
      );
    }

    log.info("===========================");
  }

  /**
   * Check if monitoring is active
   */
  isActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * Detect performance issues
   */
  detectIssues(): string[] {
    const issues: string[] = [];
    const latest = this.getLatest();

    if (!latest) {
      return issues;
    }

    // Check memory usage
    const heapUsedMB = latest.memory.heapUsed / (1024 * 1024);
    if (heapUsedMB > 512) {
      issues.push(`High memory usage: ${Math.round(heapUsedMB)}MB`);
    }

    // Check event loop lag
    if (latest.eventLoop.lag > 100) {
      issues.push(`High event loop lag: ${latest.eventLoop.lag}ms`);
    }

    // Check system memory
    const systemUsagePercent =
      ((latest.system.totalMemory - latest.system.freeMemory) /
        latest.system.totalMemory) *
      100;
    if (systemUsagePercent > 90) {
      issues.push(
        `High system memory usage: ${Math.round(systemUsagePercent)}%`,
      );
    }

    return issues;
  }
}
