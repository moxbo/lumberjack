import { describe, expect, it, vi } from "vitest";
import { createChangeEmitter } from "../changeEmitter";

describe("store change notifications", () => {
  it("registers listeners once per emitter and supports repeated unsubscribe", () => {
    const first = createChangeEmitter();
    const second = createChangeEmitter();
    const listener = vi.fn();
    const off = first.on(listener);
    first.on(listener);
    second.on(listener);
    first.emit();
    off();
    off();
    first.emit();
    expect(listener).toHaveBeenCalledTimes(1);
    second.emit();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("notifies remaining listeners even when an earlier one fails", () => {
    const report = vi.fn();
    const error = new Error("listener failed");
    for (const emitter of [
      createChangeEmitter(report),
      createChangeEmitter(),
    ]) {
      const next = vi.fn();
      emitter.on(() => {
        throw error;
      });
      emitter.on(next);
      emitter.emit();
      expect(next).toHaveBeenCalledOnce();
    }
    expect(report).toHaveBeenCalledExactlyOnceWith(error);
  });
});
