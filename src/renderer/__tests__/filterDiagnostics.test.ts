import { afterEach, describe, expect, it, vi } from "vitest";
import { FILTER_SAMPLE_LIMIT, FilterDiagnostics } from "../filterDiagnostics";

function renderer(longTasks = true) {
  let now = 0;
  let frame: (() => void) | undefined;
  let visible!: (value: boolean) => void;
  type Task = { startTime: number; duration: number };
  let deliver!: (tasks: Task[]) => void;
  const off = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      static supportedEntryTypes = longTasks ? ["longtask"] : [];
      constructor(cb: (list: { getEntries: () => Task[] }) => void) {
        deliver = (tasks) => cb({ getEntries: () => tasks });
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    frame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = undefined;
  });
  vi.stubGlobal("window", {
    api: {
      onWindowVisibilityChange(cb: typeof visible) {
        visible = cb;
        cb(true);
        return off;
      },
    },
  });
  const bounds = { top: 0, bottom: 200, left: 0, right: 200 };
  const cell = {
    getBoundingClientRect: () => bounds,
    contains: (hit: unknown) => hit === cell,
  };
  const list = {
    getBoundingClientRect: () => bounds,
    querySelector: () => null,
    querySelectorAll: vi.fn(() => [cell]),
  };
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      body: list,
      hidden: false,
      elementFromPoint: () => cell,
    }),
  );
  vi.stubGlobal("innerWidth", 200);
  vi.stubGlobal("innerHeight", 200);
  const recorder = new FilterDiagnostics();
  const dispose = recorder.connect();
  const tick = (time: number) => {
    now = time;
    const cb = frame;
    frame = undefined;
    cb?.();
  };
  return {
    recorder,
    tick,
    off,
    disconnect,
    dispose,
    list,
    visible,
    deliver,
    hasFrame: () => frame !== undefined,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("window-local filter diagnostics", () => {
  it("correlates publications and DOM commits, including late long-task delivery", () => {
    const { recorder, tick, deliver } = renderer();
    const old = { passed: 5 };
    const partial = { passed: 1 };
    const final = { passed: 2 };
    recorder.start(1, 0, 10, true);
    recorder.published(1, old, false);
    recorder.start(2, 10, 11, false);
    recorder.published(1, old, true);
    recorder.committed(old, document.body);
    recorder.published(2, partial, false);
    recorder.committed({ passed: 1 }, document.body); // not the published snapshot
    tick(20);
    recorder.committed(partial, document.body);
    tick(30);
    expect(recorder.report().samples).toEqual([]);
    recorder.published(2, final, true);
    tick(60);
    recorder.committed(final, document.body);
    deliver([
      { startTime: 35, duration: 75 },
      { startTime: 70, duration: 100 },
    ]);
    expect(recorder.report()).toEqual({
      schemaVersion: 1,
      unit: "ms",
      samples: [
        {
          trigger: "refresh",
          inputCount: 11,
          resultCount: 2,
          firstVisibleMs: 20,
          finalListMs: 50,
          longestTaskMs: 25,
        },
      ],
    });
  });

  it("never measures a partial empty list, hidden or canceled requests, or invisible results", () => {
    const { recorder, tick, visible, list, hasFrame } = renderer(false);
    const empty = { passed: 0 };
    recorder.start(1, 0, 10, true);
    recorder.published(1, empty, false);
    recorder.committed(empty, document.body);
    expect(hasFrame()).toBe(false);
    visible(false);
    recorder.start(2, 1, 10, true);
    visible(true);
    recorder.published(2, empty, true);
    recorder.committed(empty, document.body);
    expect(recorder.report().samples).toEqual([]);
    recorder.start(3, 1, 10, true);
    recorder.cancel();
    recorder.published(3, empty, true);
    recorder.committed(empty, document.body);
    expect(recorder.report().samples).toEqual([]);
    recorder.start(4, 1, 10, true);
    tick(10);
    recorder.published(4, empty, true);
    recorder.committed(empty, document.body);
    list.querySelectorAll.mockReturnValue([]);
    tick(20);
    expect(list.querySelectorAll).toHaveBeenCalledWith(".list-empty-title");
    tick(2000);
    expect(hasFrame()).toBe(false);
    expect(recorder.report().samples).toMatchObject([
      { firstVisibleMs: null, finalListMs: 9, longestTaskMs: null },
    ]);
  });

  it("bounds history and clears observations, frames and samples on disable", () => {
    const { recorder, tick, dispose, disconnect, off, hasFrame } = renderer();
    const stats = { passed: 1 };
    for (let id = 1; id <= FILTER_SAMPLE_LIMIT + 2; id++) {
      recorder.start(id, id, id, true);
      tick(id + 1);
      recorder.published(id, stats, true);
      recorder.committed(stats, document.body);
    }
    expect(recorder.report().samples).toHaveLength(FILTER_SAMPLE_LIMIT);
    expect(recorder.report().samples[0]?.inputCount).toBe(3);
    dispose();
    expect(hasFrame()).toBe(false);
    expect(recorder.report().samples).toEqual([]);
    expect(off).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
