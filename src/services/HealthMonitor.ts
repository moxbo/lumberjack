/**
 * HealthMonitor
 * Proactive health check monitoring for application services
 * Detects issues before they become critical
 */

import log from "electron-log/main";
import type { FeatureFlags } from "./FeatureFlags";

const HEALTH_CHECK_INTERVAL_MS = 60_000;

export type HealthStatus = "healthy" | "unhealthy" | "degraded" | "error";

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  error?: string;
  duration?: number;
  timestamp: number;
}

export interface HealthCheck {
  name: string;
  check: () => Promise<boolean>;
  timeout?: number;
  lastResult?: HealthCheckResult;
  lastRun?: number;
}

export interface HealthReport {
  overallStatus: HealthStatus;
  checks: HealthCheckResult[];
  timestamp: number;
}

/**
 * HealthMonitor provides proactive health checking for application services
 */
export class HealthMonitor {
  private checks = new Map<string, HealthCheck>();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly defaultTimeout = 5000; // 5 seconds
  private isRunning = false;

  /**
   * Register a health check
   */
  registerCheck(
    name: string,
    check: () => Promise<boolean>,
    timeout?: number,
  ): void {
    this.checks.set(name, {
      name,
      check,
      timeout: timeout ?? this.defaultTimeout,
    });

    log.info(`[health-monitor] Registered check: ${name}`);
  }

  /**
   * Unregister a health check
   */
  unregisterCheck(name: string): void {
    this.checks.delete(name);
    log.info(`[health-monitor] Unregistered check: ${name}`);
  }

  /**
   * Run all health checks
   */
  async runChecks(): Promise<HealthReport> {
    const results: HealthCheckResult[] = [];
    const startTime = Date.now();

    for (const [name, check] of this.checks.entries()) {
      const checkStartTime = Date.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;

      try {
        const result = await Promise.race([
          check.check(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Health check timeout")),
              check.timeout ?? this.defaultTimeout,
            );
          }),
        ]);

        const duration = Date.now() - checkStartTime;
        const checkResult: HealthCheckResult = {
          name,
          status: result ? "healthy" : "unhealthy",
          message: result ? "Check passed" : "Check failed",
          duration,
          timestamp: Date.now(),
        };

        results.push(checkResult);
        check.lastResult = checkResult;
        check.lastRun = Date.now();
      } catch (error) {
        const duration = Date.now() - checkStartTime;
        const err = error instanceof Error ? error : new Error(String(error));
        const checkResult: HealthCheckResult = {
          name,
          status: "error",
          error: err.message,
          duration,
          timestamp: Date.now(),
        };

        results.push(checkResult);
        check.lastResult = checkResult;
        check.lastRun = Date.now();

        log.error(`[health-monitor] Check failed: ${name}`, {
          error: err.message,
          duration,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    // Determine overall status
    const overallStatus = this.calculateOverallStatus(results);

    const report: HealthReport = {
      overallStatus,
      checks: results,
      timestamp: Date.now(),
    };

    const totalDuration = Date.now() - startTime;

    if (overallStatus !== "healthy") {
      log.warn("[health-monitor] Health check completed with issues", {
        overallStatus,
        duration: totalDuration,
        totalChecks: results.length,
      });
    } else {
      log.debug("[health-monitor] All health checks passed", {
        duration: totalDuration,
        totalChecks: results.length,
      });
    }

    return report;
  }

  /**
   * Calculate overall health status
   */
  private calculateOverallStatus(results: HealthCheckResult[]): HealthStatus {
    if (results.length === 0) {
      return "healthy";
    }

    const hasError = results.some((r) => r.status === "error");
    const hasUnhealthy = results.some((r) => r.status === "unhealthy");
    const hasDegraded = results.some((r) => r.status === "degraded");

    if (hasError) {
      return "error";
    }
    if (hasUnhealthy) {
      return "unhealthy";
    }
    if (hasDegraded) {
      return "degraded";
    }

    return "healthy";
  }

  /**
   * Start periodic health monitoring
   */
  startMonitoring(
    intervalMs = HEALTH_CHECK_INTERVAL_MS,
    runImmediately = true,
  ): void {
    if (this.isRunning) {
      log.warn("[health-monitor] Already monitoring");
      return;
    }

    this.isRunning = true;

    if (runImmediately) {
      this.runChecks().catch((error) => {
        log.error("[health-monitor] Initial check failed:", error);
      });
    }

    // Schedule periodic checks
    this.monitoringInterval = setInterval(() => {
      this.runChecks().catch((error) => {
        log.error("[health-monitor] Periodic check failed:", error);
      });
    }, intervalMs);

    log.info(`[health-monitor] Started monitoring (interval: ${intervalMs}ms)`);
  }

  followFeatureFlag(flags: FeatureFlags): () => void {
    const sync = () => {
      const enabled = flags.isEnabled("HEALTH_MONITORING");
      if (enabled === this.isMonitoring()) return;
      // Leave startup free of health checks. The first check runs after one interval.
      if (enabled) this.startMonitoring(HEALTH_CHECK_INTERVAL_MS, false);
      else this.stopMonitoring();
    };
    sync();
    const unsubscribe = flags.onChange(sync);
    return () => {
      unsubscribe();
      if (this.isMonitoring()) this.stopMonitoring();
    };
  }

  /**
   * Stop periodic health monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isRunning = false;
    log.info("[health-monitor] Stopped monitoring");
  }

  /**
   * Get last check results
   */
  getLastResults(): Map<string, HealthCheckResult | undefined> {
    const results = new Map<string, HealthCheckResult | undefined>();

    for (const [name, check] of this.checks.entries()) {
      results.set(name, check.lastResult);
    }

    return results;
  }

  /**
   * Check if monitoring is active
   */
  isMonitoring(): boolean {
    return this.isRunning;
  }

  /**
   * Get monitoring statistics
   */
  getStats(): {
    isMonitoring: boolean;
    totalChecks: number;
    lastResults: Array<{
      name: string;
      status?: HealthStatus;
      lastRun?: number;
    }>;
  } {
    const lastResults = Array.from(this.checks.entries()).map(
      ([name, check]) => ({
        name,
        status: check.lastResult?.status,
        lastRun: check.lastRun,
      }),
    );

    return {
      isMonitoring: this.isRunning,
      totalChecks: this.checks.size,
      lastResults,
    };
  }
}
