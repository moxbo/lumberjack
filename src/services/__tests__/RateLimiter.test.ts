/**
 * Unit tests for RateLimiter service
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock electron-log before importing the module
vi.mock("electron-log/main", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { RateLimiter } from "../RateLimiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    limiter = new RateLimiter("test-limiter", {
      tokensPerInterval: 5,
      interval: 1000,
      maxTokens: 10,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("should start with max tokens", () => {
      expect(limiter.getAvailableTokens()).toBe(10);
    });

    it("should report correct initial stats", () => {
      const stats = limiter.getStats();
      expect(stats.name).toBe("test-limiter");
      expect(stats.maxTokens).toBe(10);
      expect(stats.tokensPerInterval).toBe(5);
      expect(stats.interval).toBe(1000);
      expect(stats.totalRequests).toBe(0);
      expect(stats.throttledRequests).toBe(0);
      expect(stats.throttleRate).toBe(0);
    });
  });

  describe("tryConsume", () => {
    it("should allow requests when tokens are available", () => {
      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.getAvailableTokens()).toBe(9);
    });

    it("should consume multiple tokens at once", () => {
      expect(limiter.tryConsume(5)).toBe(true);
      expect(limiter.getAvailableTokens()).toBe(5);
    });

    it("should reject when not enough tokens", () => {
      // Consume all tokens
      expect(limiter.tryConsume(10)).toBe(true);
      // Next should be rejected
      expect(limiter.tryConsume()).toBe(false);
    });

    it("should reject when requesting more tokens than available", () => {
      expect(limiter.tryConsume(5)).toBe(true);
      // Only 5 left, requesting 6
      expect(limiter.tryConsume(6)).toBe(false);
    });

    it("should track total and throttled requests", () => {
      limiter.tryConsume(10); // success
      limiter.tryConsume(); // throttled
      limiter.tryConsume(); // throttled

      const stats = limiter.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.throttledRequests).toBe(2);
      expect(stats.throttleRate).toBe(67); // ~67%
    });
  });

  describe("token refill", () => {
    it("should refill tokens over time", () => {
      // Consume all tokens
      limiter.tryConsume(10);
      expect(limiter.getAvailableTokens()).toBe(0);

      // Advance 1 second (should add 5 tokens)
      vi.advanceTimersByTime(1000);
      expect(limiter.getAvailableTokens()).toBe(5);
    });

    it("should not exceed max tokens", () => {
      // Start at max (10), advance time
      vi.advanceTimersByTime(5000);
      expect(limiter.getAvailableTokens()).toBe(10); // capped at maxTokens
    });

    it("should refill proportionally for partial intervals", () => {
      limiter.tryConsume(10);
      // Advance 500ms (half interval = 2.5 tokens)
      vi.advanceTimersByTime(500);
      expect(limiter.getAvailableTokens()).toBe(2); // floor of 2.5
    });
  });

  describe("consume (async)", () => {
    it("should resolve immediately when tokens available", async () => {
      await limiter.consume();
      expect(limiter.getAvailableTokens()).toBe(9);
    });

    it("should wait for tokens when none available", async () => {
      limiter.tryConsume(10); // exhaust all tokens

      let resolved = false;
      const promise = limiter.consume().then(() => {
        resolved = true;
      });

      // Should not be resolved yet
      expect(resolved).toBe(false);

      // Advance time to refill
      vi.advanceTimersByTime(1000);
      await promise;

      expect(resolved).toBe(true);
    });
  });

  describe("reset", () => {
    it("should restore tokens to max and clear stats", () => {
      limiter.tryConsume(10);
      limiter.tryConsume(); // throttled

      limiter.reset();

      expect(limiter.getAvailableTokens()).toBe(10);
      const stats = limiter.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.throttledRequests).toBe(0);
    });
  });

  describe("default options", () => {
    it("should use defaults when no options provided", () => {
      const defaultLimiter = new RateLimiter("default");
      const stats = defaultLimiter.getStats();
      expect(stats.tokensPerInterval).toBe(10);
      expect(stats.interval).toBe(1000);
      expect(stats.maxTokens).toBe(20); // 2x tokensPerInterval
    });
  });
});
