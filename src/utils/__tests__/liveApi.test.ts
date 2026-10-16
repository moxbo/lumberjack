import { afterEach, describe, expect, it, vi } from "vitest";
import { liveSetPaused, onAppend } from "../typedApi";
import { LiveIngestionLimitError } from "../liveIngestionLimit";
import type { LogEntry } from "../../types/ipc";

afterEach(() => vi.unstubAllGlobals());

describe("typed live pause API", () => {
  it("reports unavailable APIs and malformed responses", async () => {
    vi.stubGlobal("window", {});
    await expect(liveSetPaused(true)).resolves.toEqual({
      ok: false,
      error: "liveSetPaused unavailable",
    });
    vi.stubGlobal("window", { api: { liveSetPaused: async () => undefined } });
    await expect(liveSetPaused(true)).resolves.toEqual({
      ok: false,
      error: "Invalid liveSetPaused response",
    });
  });

  describe("live-cap append acknowledgement boundary", () => {
    const entry: LogEntry = {
      timestamp: null,
      source: "test",
      message: "entry",
      _ingestionKind: "live",
    };

    function subscribe(callback: Parameters<typeof onAppend>[0]) {
      let listener!: Parameters<typeof onAppend>[0];
      const dispose = vi.fn();
      vi.stubGlobal("window", {
        api: {
          onAppend: (registered: Parameters<typeof onAppend>[0]) => {
            listener = registered;
            return dispose;
          },
        },
      });
      const cleanup = onAppend(callback);
      return {
        deliver: (entries: LogEntry[]) =>
          Promise.resolve().then(() => listener(entries)),
        cleanup,
        dispose,
      };
    }

    it.each(["sync", "async"])(
      "preserves a classified negative ACK after a %s live-cap rejection",
      async (mode) => {
        const limited = new LiveIngestionLimitError(3, 3);
        const subscription = subscribe(
          mode === "sync"
            ? () => {
                throw limited;
              }
            : () => Promise.reject(limited),
        );
        await expect(subscription.deliver([entry])).rejects.toEqual({
          kind: "live-entry-limit",
          message: limited.message,
        });
        subscription.cleanup();
        expect(subscription.dispose).toHaveBeenCalledOnce();
      },
    );

    it("does not turn an import's cap error into a successful acknowledgement", async () => {
      const limited = new LiveIngestionLimitError(3);
      const subscription = subscribe(() => Promise.reject(limited));
      await expect(
        subscription.deliver([{ ...entry, _ingestionKind: "import" }]),
      ).rejects.toBe(limited);
    });

    it.each(["live", "import"] as const)(
      "preserves terminal %s persistence failures",
      async (kind) => {
        const failure = new Error("storage quota exceeded");
        const subscription = subscribe(() => Promise.reject(failure));
        await expect(
          subscription.deliver([{ ...entry, _ingestionKind: kind }]),
        ).rejects.toBe(failure);
      },
    );

    it("does not classify ordinary errors by their name or message", async () => {
      const failure = new Error(new LiveIngestionLimitError(3).message);
      failure.name = "LiveIngestionLimitError";
      const subscription = subscribe(() => Promise.reject(failure));
      await expect(subscription.deliver([entry])).rejects.toBe(failure);
    });
  });

  it("forwards pause/unpause and reports source-stop and transport failures", async () => {
    const pause = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "watcher stop failed" })
      .mockRejectedValueOnce(new Error("IPC closed"));
    vi.stubGlobal("window", { api: { liveSetPaused: pause } });
    await expect(liveSetPaused(true)).resolves.toEqual({ ok: true });
    await expect(liveSetPaused(false)).resolves.toEqual({
      ok: false,
      error: "watcher stop failed",
    });
    await expect(liveSetPaused(true)).resolves.toEqual({
      ok: false,
      error: "IPC closed",
    });
    expect(pause.mock.calls).toEqual([[true], [false], [true]]);
  });
});
