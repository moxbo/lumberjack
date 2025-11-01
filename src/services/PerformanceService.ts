/**
 * PerformanceService
 * Tracks and logs application performance metrics, especially startup time
 */

import log from 'electron-log/main';

/**
 * Performance mark
 */
interface PerformanceMark {
  name: string;
  timestamp: number;
  duration?: number;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  startupTime: number;
  marks: PerformanceMark[];
  platform: string;
  electronVersion: string;
  nodeVersion: string;
}

/**
 * PerformanceService for tracking application performance
 */
export class PerformanceService {
  private startTime: number;
  private marks: Map<string, number> = new Map();
  private metrics: PerformanceMark[] = [];

  constructor() {
    this.startTime = Date.now();
    this.mark('app-start');
  }

  /**
   * Mark a performance point
   */
  mark(name: string): void {
    const now = Date.now();
    const duration = now - this.startTime;

    this.marks.set(name, now);
    this.metrics.push({ name, timestamp: now, duration });

    log.info(`[PERF] ${name}: ${duration}ms`);
  }

  /**
   * Measure duration between two marks
   */
  measure(name: string, startMark: string, endMark?: string): number | null {
    const start = this.marks.get(startMark);
    const end = endMark ? this.marks.get(endMark) : Date.now();

    if (!start || !end) {
      log.warn(`[PERF] Cannot measure ${name}: marks not found`);
      return null;
    }

    const duration = end - start;
    log.info(`[PERF] ${name}: ${duration}ms (${startMark} → ${endMark ?? 'now'})`);

    return duration;
  }

  /**
   * Get time since app start
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get all metrics
   */
  getMetrics(): PerformanceMetrics {
    return {
      startupTime: this.getElapsedTime(),
      marks: [...this.metrics],
      platform: process.platform,
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node,
    };
  }

  /**
   * Log summary of performance metrics
   */
  logSummary(): void {
    const metrics = this.getMetrics();

    log.info('=== Performance Summary ===');
    log.info(`Platform: ${metrics.platform}`);
    log.info(`Electron: ${metrics.electronVersion}`);
    log.info(`Node: ${metrics.nodeVersion}`);
    log.info(`Total startup time: ${metrics.startupTime}ms`);
    log.info('=== Marks ===');

    for (const mark of metrics.marks) {
      log.info(`  ${mark.name}: ${mark.duration}ms`);
    }

    log.info('=========================');
  }

  /**
   * Check if startup time exceeds threshold and log warning
   */
  checkStartupPerformance(thresholdMs: number = 3000): void {
    const elapsed = this.getElapsedTime();

    if (elapsed > thresholdMs) {
      log.warn(`⚠️  Slow startup detected: ${elapsed}ms (threshold: ${thresholdMs}ms)`);
      log.warn('Consider optimizing module loading or deferring heavy operations');
      this.logSummary();
    } else {
      log.info(`✓ Startup performance OK: ${elapsed}ms`);
    }

    // Always log a detailed breakdown for analysis
    this.logDetailedBreakdown();
  }

  /**
   * Log detailed breakdown of time between consecutive marks
   */
  logDetailedBreakdown(): void {
    if (this.metrics.length === 0) return;

    log.info('=== Startup Time Breakdown ===');
    for (let i = 1; i < this.metrics.length; i++) {
      const prev = this.metrics[i - 1];
      const curr = this.metrics[i];
      const delta = (curr?.duration ?? 0) - (prev?.duration ?? 0);
      log.info(`  ${prev?.name} → ${curr?.name}: ${delta}ms`);
    }
    log.info('==============================');
  }
}
