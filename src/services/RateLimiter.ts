/**
 * RateLimiter
 * Implements token bucket algorithm for rate limiting
 * Prevents system overload by controlling request rates
 */

import log from "electron-log/main";

export interface RateLimiterOptions {
  tokensPerInterval?: number; // Number of tokens to add per interval
  interval?: number; // Interval in milliseconds
  maxTokens?: number; // Maximum token bucket capacity
}

/**
 * RateLimiter controls request rates using token bucket algorithm
 */
export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly tokensPerInterval: number;
  private readonly interval: number;
  private lastRefillTime: number;
  private readonly name: string;
  private totalRequests = 0;
  private throttledRequests = 0;

  constructor(name: string, options: RateLimiterOptions = {}) {
    this.name = name;
    this.tokensPerInterval = options.tokensPerInterval ?? 10;
    this.interval = options.interval ?? 1000; // 1 second default
    this.maxTokens = options.maxTokens ?? this.tokensPerInterval * 2;
    this.tokens = this.maxTokens;
    this.lastRefillTime = Date.now();
  }

  /**
   * Try to consume a token. Returns true if allowed, false if rate limited
   */
  tryConsume(tokensToConsume: number = 1): boolean {
    this.refillTokens();
    this.totalRequests++;

    if (this.tokens >= tokensToConsume) {
      this.tokens -= tokensToConsume;
      return true;
    }

    this.throttledRequests++;
    
    if (this.throttledRequests % 10 === 0) {
      log.warn(`[rate-limiter:${this.name}] Rate limit exceeded`, {
        throttledRequests: this.throttledRequests,
        totalRequests: this.totalRequests,
        availableTokens: this.tokens,
      });
    }

    return false;
  }

  /**
   * Wait until a token is available (async rate limiting)
   */
  async consume(tokensToConsume: number = 1): Promise<void> {
    while (!this.tryConsume(tokensToConsume)) {
      // Calculate wait time based on token refill rate
      const tokensNeeded = tokensToConsume - this.tokens;
      const waitTimeMs = (tokensNeeded / this.tokensPerInterval) * this.interval;
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitTimeMs, this.interval)));
    }
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;

    if (elapsed > 0) {
      const tokensToAdd = (elapsed / this.interval) * this.tokensPerInterval;
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  /**
   * Get current token count
   */
  getAvailableTokens(): number {
    this.refillTokens();
    return Math.floor(this.tokens);
  }

  /**
   * Get statistics
   */
  getStats(): {
    name: string;
    availableTokens: number;
    maxTokens: number;
    tokensPerInterval: number;
    interval: number;
    totalRequests: number;
    throttledRequests: number;
    throttleRate: number;
  } {
    return {
      name: this.name,
      availableTokens: this.getAvailableTokens(),
      maxTokens: this.maxTokens,
      tokensPerInterval: this.tokensPerInterval,
      interval: this.interval,
      totalRequests: this.totalRequests,
      throttledRequests: this.throttledRequests,
      throttleRate:
        this.totalRequests > 0
          ? Math.round((this.throttledRequests / this.totalRequests) * 100)
          : 0,
    };
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefillTime = Date.now();
    this.totalRequests = 0;
    this.throttledRequests = 0;
    log.info(`[rate-limiter:${this.name}] Reset`);
  }
}
