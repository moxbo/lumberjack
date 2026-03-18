import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { ShutdownCoordinator } from "../ShutdownCoordinator";
describe("ShutdownCoordinator", () => {
  let coordinator: ShutdownCoordinator;
  beforeEach(() => {
    coordinator = new ShutdownCoordinator(1000);
  });
  it("should register handlers", () => {
    coordinator.register("test", async () => {});
    expect(coordinator.getHandlers()).toEqual(["test"]);
  });
  it("should execute all handlers in order", async () => {
    const order: string[] = [];
    coordinator.register("first", async () => {
      order.push("first");
    });
    coordinator.register("second", async () => {
      order.push("second");
    });
    await coordinator.shutdown();
    expect(order).toEqual(["first", "second"]);
  });
  it("should continue if one handler fails", async () => {
    const executed: string[] = [];
    coordinator.register("failing", async () => {
      throw new Error("fail");
    });
    coordinator.register("ok", async () => {
      executed.push("ok");
    });
    await coordinator.shutdown();
    expect(executed).toEqual(["ok"]);
  });
  it("should prevent re-entrant shutdown", async () => {
    let count = 0;
    coordinator.register("slow", async () => {
      count++;
      await new Promise((r) => setTimeout(r, 100));
    });
    await Promise.all([coordinator.shutdown(), coordinator.shutdown()]);
    expect(count).toBe(1);
  });
  it("should timeout if handlers take too long", async () => {
    const fast = new ShutdownCoordinator(50);
    fast.register("slow", async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    await fast.shutdown();
    expect(fast.isInProgress()).toBe(false);
  });
  it("should reset isInProgress after shutdown", async () => {
    coordinator.register("test", async () => {});
    await coordinator.shutdown();
    expect(coordinator.isInProgress()).toBe(false);
  });
  it("should clear all handlers", () => {
    coordinator.register("a", async () => {});
    coordinator.register("b", async () => {});
    coordinator.clear();
    expect(coordinator.getHandlers()).toEqual([]);
  });
});
