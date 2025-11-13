/**
 * CircuitBreaker
 * Implements circuit breaker pattern for resilient service calls
 * Prevents cascading failures by stopping requests to failing services
 */

import log from "electron-log/main";

export enum CircuitState {
  CLOSED = "CLOSED", // Normal operation
  OPEN = "OPEN", // Failing, reject requests
  HALF_OPEN = "HALF_OPEN", // Testing if recovered
}

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Number of failures before opening circuit
  successThreshold?: number; // Number of successes to close circuit from half-open
  timeout?: number; // Time in ms before trying to close circuit
  monitoringWindow?: number; // Time window for failure tracking (ms)
}

/**
 * CircuitBreaker protects services from cascading failures
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly timeout: number;
  private readonly name: string;

  constructor(name: string, options: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 30000; // 30 seconds default
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        // Try to recover
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        log.info(`[circuit-breaker:${this.name}] Moving to HALF_OPEN state`);
      } else {
        throw new Error(
          `Circuit breaker is OPEN for ${this.name} (${Math.round((Date.now() - this.lastFailureTime) / 1000)}s ago)`,
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        log.info(
          `[circuit-breaker:${this.name}] Circuit CLOSED after recovery`,
        );
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed during recovery attempt
      this.state = CircuitState.OPEN;
      log.warn(
        `[circuit-breaker:${this.name}] Circuit OPEN (failed during recovery)`,
      );
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      log.warn(
        `[circuit-breaker:${this.name}] Circuit OPEN (${this.failureCount} failures)`,
      );
    }
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): {
    name: string;
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    log.info(`[circuit-breaker:${this.name}] Manually reset`);
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }
}
