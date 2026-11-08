import { afterEach, describe, expect, it, vi } from "vitest";
import { VisibilityScheduler } from "../visibilityScheduler";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("coalesces hidden publications and immediately flushes on becoming visible", () => {
  vi.useFakeTimers();
  const document = Object.assign(new EventTarget(), { hidden: true });
  vi.stubGlobal("document", document);
  const publish = vi.fn();
  const scheduler = new VisibilityScheduler(publish, () => 50);
  try {
    scheduler.schedule(true);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50);
      scheduler.schedule(true);
    }
    expect(publish).not.toHaveBeenCalled();
    document.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    scheduler.schedule(true);
    expect(publish).toHaveBeenCalledTimes(2);
  } finally {
    scheduler.dispose();
  }
});

describe("VisibilityScheduler", () => {
  it("uses native hidden/minimized state even when Electron reports a visible document", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { hidden: false }),
    );
    let receive!: (visible: boolean) => void;
    const off = vi.fn();
    vi.stubGlobal("window", {
      api: {
        onWindowVisibilityChange: (callback: typeof receive) => {
          receive = callback;
          return off;
        },
      },
    });
    const publish = vi.fn();
    const scheduler = new VisibilityScheduler(publish);
    receive(false);
    scheduler.schedule(true);
    vi.advanceTimersByTime(900);
    expect(publish).not.toHaveBeenCalled();
    receive(true);
    expect(publish).toHaveBeenCalledTimes(1);
    scheduler.dispose();
    expect(off).toHaveBeenCalledOnce();
  });

  it("uses a bounded hidden cadence and permits immediate control publications", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { hidden: true }),
    );
    const publish = vi.fn();
    const scheduler = new VisibilityScheduler(publish);
    scheduler.schedule(true);
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    scheduler.schedule();
    scheduler.flush();
    expect(publish).toHaveBeenCalledTimes(2);
    scheduler.schedule();
    scheduler.dispose();
    vi.advanceTimersByTime(2000);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("reschedules a pending foreground update when hidden", () => {
    vi.useFakeTimers();
    const document = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("document", document);
    const publish = vi.fn();
    const scheduler = new VisibilityScheduler(publish, () => 50);
    scheduler.schedule();
    document.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(50);
    expect(publish).not.toHaveBeenCalled();
    scheduler.cancel();
    document.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(publish).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});
