import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../../types/ipc";
import { loadFullEntry } from "../entryPayload";
import { textChunks } from "../textChunks";

const api = vi.hoisted(() => ({
  load: vi.fn<(reference: string) => Promise<LogEntry>>(),
}));
vi.mock("../typedApi", () => ({ entryPayloadLoad: api.load }));

beforeEach(() => vi.clearAllMocks());

describe("loadFullEntry", () => {
  it("does not read storage for ordinary entries and restores legacy full messages", async () => {
    const entry = { message: "ordinary" };
    expect(await loadFullEntry(entry)).toBe(entry);
    expect(
      await loadFullEntry({ message: "preview", _fullMessage: "full" }),
    ).toMatchObject({
      message: "full",
    });
    expect(api.load).not.toHaveBeenCalled();
  });

  it("coalesces concurrent requests without retaining decoded payloads afterwards", async () => {
    let resolve!: (entry: LogEntry) => void;
    api.load.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    const preview = {
      _id: 7,
      _payloadRef: "reference",
      message: "preview",
      signature: "stable",
      _mark: "#ff0000",
    };
    const first = loadFullEntry(preview);
    const second = loadFullEntry({ ...preview, _id: 8 });
    expect(api.load).toHaveBeenCalledOnce();
    const full = {
      timestamp: null,
      source: "test",
      message: "complete message and tail",
      stackTrace: "complete trace",
      raw: { original: true },
      mdc: { tenant: "example" },
    };
    resolve(full);
    expect(await first).toMatchObject({
      ...preview,
      message: full.message,
      _fullMessage: full.message,
      raw: full.raw,
      stackTrace: full.stackTrace,
      mdc: full.mdc,
    });
    expect((await second)._id).toBe(8);
    api.load.mockResolvedValueOnce(full);
    await loadFullEntry(preview);
    expect(api.load).toHaveBeenCalledTimes(2);
  });

  it("propagates missing originals instead of returning a preview as complete content", async () => {
    const error = new Error("disk read failed");
    api.load.mockRejectedValueOnce(error);
    await expect(
      loadFullEntry({ _payloadRef: "failed", message: "preview" }),
    ).rejects.toBe(error);
    api.load.mockResolvedValueOnce({
      timestamp: null,
      source: "test",
      message: "restored",
    });
    expect(
      (await loadFullEntry({ _payloadRef: "failed", message: "preview" }))
        .message,
    ).toBe("restored");
  });

  it("rejects invalid transport references", async () => {
    await expect(
      loadFullEntry({ _payloadRef: 17, message: "preview" }),
    ).rejects.toThrow("Invalid");
    expect(api.load).not.toHaveBeenCalled();
  });
});

describe("textChunks", () => {
  it("preserves UTF-8 including surrogate pairs on write boundaries", () => {
    const text = 'abc😀ä\\"\n'.repeat(100);
    for (const size of [2, 3, 4, 7, 64]) {
      const parts = [...textChunks(text, size)];
      expect(parts.every((part) => part.length <= size)).toBe(true);
      expect(
        Buffer.concat(parts.map((part) => Buffer.from(part))).toString("utf8"),
      ).toBe(text);
    }
    expect(() => [...textChunks(text, 1)]).toThrow(RangeError);
  });
});
