/**
 * Unit tests for CircuitBreaker service
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock electron-log before importing the module
vi.mock("electron-log/main", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { CircuitBreaker, CircuitState } from "../CircuitBreaker";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker("test-breaker", {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
    });
  });

  describe("initial state", () => {
    it("should start in CLOSED state", () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it("should not be open initially", () => {
      expect(breaker.isOpen()).toBe(false);
    });

    it("should report correct initial stats", () => {
      const stats = breaker.getStats();
      expect(stats.name).toBe("test-breaker");
      expect(stats.state).toBe(CircuitState.CLOSED);
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.lastFailureTime).toBe(0);
    });
  });

  describe("execute - success path", () => {
    it("should execute successfully and stay CLOSED", async () => {
      const result = await breaker.execute(() => Promise.resolve("ok"));
      expect(result).toBe("ok");
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it("should reset failure count on success", async () => {
      // Cause some failures (but not enough to open)
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {
          // expected
        }
      }
      expect(breaker.getStats().failureCount).toBe(2);

      // Success should reset failure count
      await breaker.execute(() => Promise.resolve("ok"));
      expect(breaker.getStats().failureCount).toBe(0);
    });
  });

  describe("execute - failure path", () => {
    it("should open circuit after reaching failure threshold", async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {
          // expected
        }
      }

      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(breaker.isOpen()).toBe(true);
    });

    it("should reject calls immediately when OPEN", async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {
          // expected
        }
      }

      // Subsequent calls should be rejected without executing the function
      const fn = vi.fn(() => Promise.resolve("should not run"));
      await expect(breaker.execute(fn)).rejects.toThrow(
        /Circuit breaker is OPEN/,
      );
      expect(fn).not.toHaveBeenCalled();
    });

    it("should propagate the original error", async () => {
      await expect(
        breaker.execute(() => Promise.reject(new Error("specific error"))),
      ).rejects.toThrow("specific error");
    });
  });

  describe("recovery (HALF_OPEN)", () => {
    beforeEach(async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {
          // expected
        }
      }
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it("should transition to HALF_OPEN after timeout", async () => {
      // Advance time past the timeout
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100);

      // The next call should be allowed (HALF_OPEN)
      const result = await breaker.execute(() => Promise.resolve("recovered"));
      expect(result).toBe("recovered");
      vi.useRealTimers();
    });

    it("should close circuit after enough successes in HALF_OPEN", async () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100);

      // Need successThreshold (2) successes to close
      await breaker.execute(() => Promise.resolve("ok"));
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      await breaker.execute(() => Promise.resolve("ok"));
      expect(breaker.getState()).toBe(CircuitState.CLOSED);

      vi.useRealTimers();
    });

    it("should reopen circuit if failure occurs in HALF_OPEN", async () => {
      vi.useFakeTimers();
      vi.advanceTimersByTime(1100);

      // First call in HALF_OPEN succeeds
      await breaker.execute(() => Promise.resolve("ok"));
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Second call fails - should go back to OPEN
      try {
        await breaker.execute(() => Promise.reject(new Error("fail again")));
      } catch {
        // expected
      }
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      vi.useRealTimers();
    });
  });

  describe("reset", () => {
    it("should reset to CLOSED state with zeroed counters", async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => Promise.reject(new Error("fail")));
        } catch {
          // expected
        }
      }
      expect(breaker.isOpen()).toBe(true);

      breaker.reset();

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.isOpen()).toBe(false);
      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.lastFailureTime).toBe(0);
    });
  });

  describe("default options", () => {
    it("should use default thresholds when not specified", () => {
      const defaultBreaker = new CircuitBreaker("default");
      const stats = defaultBreaker.getStats();
      expect(stats.name).toBe("default");
      expect(stats.state).toBe(CircuitState.CLOSED);
    });
  });
});
