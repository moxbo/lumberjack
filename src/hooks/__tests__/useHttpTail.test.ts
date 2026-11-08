import { afterEach, describe, expect, it, vi } from "vitest";
import { useHttpTail } from "../useHttpTail";
import type { ActiveHttpTail, HttpTailStatusPayload } from "../../types/ipc";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  effects: [] as (() => unknown)[],
}));
vi.mock("preact/hooks", () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useCallback: <T>(value: T) => value,
  useMemo: <T>(value: () => T) => value(),
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
  useState: <T>(initial: T | (() => T)) => {
    const index = hooks.states.length;
    hooks.states.push(
      typeof initial === "function" ? (initial as () => T)() : initial,
    );
    return [
      hooks.states[index],
      (next: T | ((old: T) => T)) => {
        hooks.states[index] =
          typeof next === "function"
            ? (next as (old: T) => T)(hooks.states[index] as T)
            : next;
      },
    ];
  },
}));

afterEach(() => vi.unstubAllGlobals());

describe("HTTP tail status", () => {
  it("keeps a transfer-mode event that arrives before an older list response", async () => {
    hooks.states = [];
    hooks.effects = [];
    let receive!: (payload: HttpTailStatusPayload) => void;
    let finish!: (result: { ok: boolean; tails: ActiveHttpTail[] }) => void;
    const listed = new Promise<{ ok: boolean; tails: ActiveHttpTail[] }>(
      (resolve) => {
        finish = resolve;
      },
    );
    vi.stubGlobal("window", {
      api: {
        httpTailList: () => listed,
        onHttpTailStatus: (listener: typeof receive) => {
          receive = listener;
          return () => {};
        },
      },
    });
    useHttpTail();
    hooks.effects.forEach((effect) => effect());
    receive({
      type: "transfer-mode",
      id: 1,
      url: "http://example.test/log",
      transferMode: "full",
    });
    finish({
      ok: true,
      tails: [
        {
          id: 1,
          url: "http://example.test/log",
          offset: 4,
          paused: false,
          nextPollAt: null,
          intervalMs: 2000,
          transferMode: "unknown",
        },
      ],
    });
    await listed;
    await Promise.resolve();
    expect(hooks.states[0]).toEqual([
      expect.objectContaining({ transferMode: "full" }),
    ]);
    receive({
      type: "transfer-mode",
      id: 1,
      url: "http://example.test/log",
      transferMode: "range",
    });
    expect(hooks.states[0]).toEqual([
      expect.objectContaining({ transferMode: "range" }),
    ]);
  });
});
