/**
 * AdaptiveBatchService
 * Dynamically adjusts batch send delay based on processing performance
 * to optimize throughput while maintaining UI responsiveness
 */

import log from "electron-log/main";

export interface BatchMetrics {
  processingTimeMs: number;
  batchCount: number;
  entryCount: number;
  timestamp: number;
}

/**
 * AdaptiveBatchService optimizes batch processing delays
 * by adapting to current system performance
 */
export class AdaptiveBatchService {
  private readonly BASE_DELAY_MS = 8; // Base delay in milliseconds
  private readonly MIN_DELAY_MS = 4; // Minimum delay
  private readonly MAX_DELAY_MS = 100; // Maximum delay
  private readonly SLOW_THRESHOLD_MS = 100; // Threshold for slow processing
  private readonly FAST_THRESHOLD_MS = 20; // Threshold for fast processing

  private currentDelay: number;
  private lastProcessingTime: number = 0;
  private metricsHistory: BatchMetrics[] = [];
  private readonly MAX_HISTORY = 10;

  constructor() {
    this.currentDelay = this.BASE_DELAY_MS;
  }

  /**
   * Get the current adaptive delay
   */
  getDelay(): number {
    return this.currentDelay;
  }

  /**
   * Adjust delay based on processing time
   */
  adjustDelay(processingTimeMs: number, batchCount: number = 1, entryCount: number = 0): void {
    this.lastProcessingTime = processingTimeMs;

    // Store metrics for analysis
    this.metricsHistory.push({
      processingTimeMs,
      batchCount,
      entryCount,
      timestamp: Date.now(),
    });

    // Keep only recent history
    if (this.metricsHistory.length > this.MAX_HISTORY) {
      this.metricsHistory.shift();
    }

    // Adjust delay based on processing time
    if (processingTimeMs > this.SLOW_THRESHOLD_MS) {
      // System is struggling - increase delay
      const increment = Math.ceil(processingTimeMs / 50);
      this.currentDelay = Math.min(this.MAX_DELAY_MS, this.currentDelay + increment);
      
      log.debug("[adaptive-batch] Increased delay due to slow processing", {
        processingTimeMs,
        newDelay: this.currentDelay,
        increment,
      });
    } else if (processingTimeMs < this.FAST_THRESHOLD_MS) {
      // System is fast - decrease delay
      this.currentDelay = Math.max(this.MIN_DELAY_MS, this.currentDelay - 1);
      
      if (this.currentDelay === this.MIN_DELAY_MS) {
        log.debug("[adaptive-batch] At minimum delay", {
          processingTimeMs,
          delay: this.currentDelay,
        });
      }
    }
  }

  /**
   * Reset to base delay
   */
  reset(): void {
    this.currentDelay = this.BASE_DELAY_MS;
    this.lastProcessingTime = 0;
    this.metricsHistory = [];
    log.debug("[adaptive-batch] Reset to base delay", {
      delay: this.currentDelay,
    });
  }

  /**
   * Get metrics summary
   */
  getMetrics(): {
    currentDelay: number;
    lastProcessingTime: number;
    avgProcessingTime: number;
    historySize: number;
  } {
    const avgProcessingTime =
      this.metricsHistory.length > 0
        ? this.metricsHistory.reduce((sum, m) => sum + m.processingTimeMs, 0) /
          this.metricsHistory.length
        : 0;

    return {
      currentDelay: this.currentDelay,
      lastProcessingTime: this.lastProcessingTime,
      avgProcessingTime: Math.round(avgProcessingTime),
      historySize: this.metricsHistory.length,
    };
  }
}
