import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGED_DB_NAME } from "../indexedDb";
import {
  PAGED_SESSION_DATABASE_NAME,
  startPagedSessionLifecycle,
} from "../session";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("paged generation cleanup", () => {
  it.each([false, true])(
    "reclaims stale generations safely (cleanup fails: %s)",
    async (failGeneration) => {
      vi.useFakeTimers();
      const now = Date.now();
      const stale = `${PAGED_DB_NAME}-stale-c${now - 120_000}`;
      const orphan = `${PAGED_DB_NAME}-orphan-c${now - 120_000}`;
      const active = `${PAGED_DB_NAME}-active-c${now - 120_000}`;
      const recent = `${PAGED_DB_NAME}-recent-c${now}`;
      let registry = JSON.stringify({ [stale]: now - 120_000, [active]: now });
      vi.stubGlobal("localStorage", {
        getItem: () => registry,
        setItem: (_key: string, value: string) => {
          registry = value;
        },
      });
      vi.stubGlobal("navigator", {});
      vi.stubGlobal("window", { setInterval, clearInterval });
      const deleteDatabase = vi.fn((name: string) => {
        const request = {
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          error: new Error("cleanup failed"),
        };
        queueMicrotask(() => {
          if (failGeneration && name === `${stale}-generation-1`) {
            request.onerror?.();
          } else {
            request.onsuccess?.();
          }
        });
        return request;
      });
      vi.stubGlobal("indexedDB", {
        databases: async () =>
          [
            stale,
            `${stale}-generation-1`,
            `${orphan}-generation-1`,
            `${active}-generation-1`,
            `${recent}-generation-1`,
            `${PAGED_SESSION_DATABASE_NAME}-generation-1`,
          ].map((name) => ({ name })),
        deleteDatabase,
      });
      const onError = vi.fn();
      const stop = startPagedSessionLifecycle(onError);
      await vi.advanceTimersByTimeAsync(0);
      expect(deleteDatabase.mock.calls).toEqual([
        [stale],
        [`${stale}-generation-1`],
      ]);
      if (failGeneration) {
        expect(JSON.parse(registry)).toHaveProperty(stale);
      } else {
        expect(JSON.parse(registry)).not.toHaveProperty(stale);
      }
      expect(JSON.parse(registry)).toHaveProperty(active);
      expect(onError).toHaveBeenCalledTimes(failGeneration ? 1 : 0);
      stop();
      expect(JSON.parse(registry)).toHaveProperty(PAGED_SESSION_DATABASE_NAME);
    },
  );
});
