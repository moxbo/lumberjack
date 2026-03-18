/**
 * Unit tests for AdaptiveBatchService
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { AdaptiveBatchService } from "../AdaptiveBatchService";

describe("AdaptiveBatchService", () => {
  let service: AdaptiveBatchService;

  beforeEach(() => {
    service = new AdaptiveBatchService();
  });

  describe("initial state", () => {
    it("should start with base delay of 8ms", () => {
      expect(service.getDelay()).toBe(8);
    });

    it("should report initial metrics", () => {
      const metrics = service.getMetrics();
      expect(metrics.currentDelay).toBe(8);
      expect(metrics.lastProcessingTime).toBe(0);
      expect(metrics.avgProcessingTime).toBe(0);
      expect(metrics.historySize).toBe(0);
    });
  });

  describe("adjustDelay", () => {
    it("should increase delay for slow processing (>100ms)", () => {
      service.adjustDelay(200, 1, 100);
      expect(service.getDelay()).toBeGreaterThan(8);
    });

    it("should decrease delay for fast processing (<20ms)", () => {
      // First increase it
      service.adjustDelay(200, 1, 100);
      const increased = service.getDelay();

      // Then fast processing should decrease it
      service.adjustDelay(10, 1, 100);
      expect(service.getDelay()).toBeLessThan(increased);
    });

    it("should not go below minimum delay (4ms)", () => {
      // Many fast adjustments
      for (let i = 0; i < 100; i++) {
        service.adjustDelay(1, 1, 10);
      }
      expect(service.getDelay()).toBe(4);
    });

    it("should not exceed maximum delay (100ms)", () => {
      // Many slow adjustments
      for (let i = 0; i < 100; i++) {
        service.adjustDelay(1000, 1, 100);
      }
      expect(service.getDelay()).toBe(100);
    });

    it("should keep metrics history limited to 10 entries", () => {
      for (let i = 0; i < 20; i++) {
        service.adjustDelay(50, 1, 10);
      }
      expect(service.getMetrics().historySize).toBe(10);
    });

    it("should calculate average processing time", () => {
      service.adjustDelay(10, 1, 10);
      service.adjustDelay(20, 1, 10);
      service.adjustDelay(30, 1, 10);
      expect(service.getMetrics().avgProcessingTime).toBe(20);
    });
  });

  describe("reset", () => {
    it("should reset delay to base and clear history", () => {
      service.adjustDelay(500, 1, 100); // increase delay
      expect(service.getDelay()).toBeGreaterThan(8);

      service.reset();
      expect(service.getDelay()).toBe(8);
      expect(service.getMetrics().lastProcessingTime).toBe(0);
      expect(service.getMetrics().historySize).toBe(0);
    });
  });

  describe("no change for moderate processing", () => {
    it("should not change delay for processing between 20-100ms", () => {
      const initial = service.getDelay();
      service.adjustDelay(50, 1, 100);
      expect(service.getDelay()).toBe(initial);
    });
  });
});
