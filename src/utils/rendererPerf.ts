/**
 * Renderer Performance Tracking Utility
 * Tracks and logs renderer-side performance metrics
 */

class RendererPerformanceTracker {
  private startTime: number;
  private marks: Map<string, number> = new Map();

  constructor() {
    this.startTime = performance.now();
    this.mark("renderer-init");
  }

  /**
   * Mark a performance point
   */
  mark(name: string): void {
    const now = performance.now();
    const duration = now - this.startTime;
    this.marks.set(name, now);

    // Log to console for debugging
    // eslint-disable-next-line no-console
    console.log(`[RENDERER-PERF] ${name}: ${Math.round(duration)}ms`);
  }

  /**
   * Get time since start
   */
  getElapsedTime(): number {
    return performance.now() - this.startTime;
  }

  /**
   * Measure duration between two marks
   */
  measure(name: string, startMark: string, endMark?: string): number | null {
    const start = this.marks.get(startMark);
    const end = endMark ? this.marks.get(endMark) : performance.now();

    if (!start || !end) {
      console.warn(`[RENDERER-PERF] Cannot measure ${name}: marks not found`);
      return null;
    }

    const duration = end - start;
    // eslint-disable-next-line no-console
    console.log(
      `[RENDERER-PERF] ${name}: ${Math.round(duration)}ms (${startMark} → ${endMark ?? "now"})`,
    );
    return duration;
  }
}

// Export singleton instance
export const rendererPerf = new RendererPerformanceTracker();
