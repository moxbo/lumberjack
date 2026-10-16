import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntryPayloadStore } from "../EntryPayloadStore";
import { toEntry } from "../parsers";
import { WindowAppendQueue } from "../../services/WindowAppendQueue";
import { MAX_ENTRY_PAYLOAD_BYTES } from "../../utils/entryLimits";
import { estimatePayloadBytes } from "../../utils/estimatePayloadBytes";
import { InMemoryLogRepository } from "../../store/paged/InMemoryLogRepository";
import { loadFullEntry } from "../../utils/entryPayload";

vi.mock("electron-log/main", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

class Owner extends EventEmitter {
  destroyed = false;
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

let directory: string;
let store: EntryPayloadStore;

beforeEach(async () => {
  directory = path.resolve(`.payload-test-${randomUUID()}`);
  await mkdir(directory);
  store = new EntryPayloadStore({ parentDirectory: directory });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

describe("EntryPayloadStore", () => {
  it("leaves small entries alone without creating files or owner listeners", async () => {
    const owner = new Owner();
    const entry = toEntry({ message: "small" }, "", "test");
    expect(await store.retain(owner, entry)).toBe(entry);
    expect(await readdir(directory)).toEqual([]);
    expect(owner.listenerCount("destroyed")).toBe(0);
  });

  it("stores originals exceeding the queue budget losslessly and queues only their previews", async () => {
    const owner = new Owner();
    const message =
      "x".repeat(17 * 1024 * 1024) +
      '\n<tail quote="x">\u00e4\u{1f600}\\</tail>';
    const raw = {
      "@timestamp": "2026-10-15T06:21:26.613Z",
      message,
      level: "INFO",
      logger_name: "large-message",
      thread_name: "worker",
      stack_trace: "trace\n" + "frame\n".repeat(1000),
      mdc: { tenant: "example" },
    };
    const entry = toEntry(raw, "", "tcp:synthetic");
    expect(estimatePayloadBytes(entry)).toBeGreaterThan(
      MAX_ENTRY_PAYLOAD_BYTES,
    );
    const preview = await store.retain(owner, entry);
    expect(preview).toMatchObject({
      timestamp: raw["@timestamp"],
      level: raw.level,
      logger: raw.logger_name,
      thread: raw.thread_name,
      mdc: raw.mdc,
      _truncated: true,
      _messageSize: Buffer.byteLength(message),
      _hasStack: true,
    });
    expect(preview._payloadRef).toEqual(expect.any(String));
    expect(preview._fullMessage).toBeUndefined();
    expect(preview.raw).toBeUndefined();
    expect(preview.stackTrace).toBeUndefined();
    expect(preview.message.length).toBeLessThan(51 * 1024);

    const queue = new WindowAppendQueue(estimatePayloadBytes);
    const receipt = queue.enqueue([preview]);
    expect(queue.bytes).toBeLessThan(256 * 1024);
    await queue.flush(
      async (blocks) => {
        for (const batch of blocks.batches(5000))
          expect(batch).toEqual([preview]);
      },
      () => 0,
    );
    await receipt;

    const repository = new InMemoryLogRepository();
    const [id] = await repository.putMany([preview]);
    const cached = (await repository.getPayload(id!))!;
    const load = vi.fn(async (reference: string) => ({
      ok: true,
      data: await store.load(owner, reference),
    }));
    vi.stubGlobal("window", { api: { entryPayloadLoad: load } });
    expect(cached._payloadRef).toBe(preview._payloadRef);
    expect(cached._fullMessage).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    const loaded = await loadFullEntry(cached);
    expect(load).toHaveBeenCalledOnce();
    expect(loaded.message).toBe(message);
    expect(loaded.stackTrace).toBe(raw.stack_trace);
    expect(loaded.raw).toEqual(raw);
    expect(loaded.mdc).toEqual(raw.mdc);
    expect(entry._fullMessage).toBe(message);
    const [folder] = await readdir(directory);
    expect(await readdir(path.join(directory, folder!))).toHaveLength(1);
  });

  it("retains large diagnostic context while bounding its view-only preview", async () => {
    const owner = new Owner();
    const context = "payload".repeat(100_000);
    const entry = toEntry({ message: "small", mdc: { context } }, "", "test");
    const preview = await store.retain(owner, entry);
    expect(preview._payloadMdcTruncated).toBe(true);
    expect(String(preview.mdc!.context).length).toBeLessThan(2050);
    expect(estimatePayloadBytes(preview)).toBeLessThan(256 * 1024);
    expect((await store.load(owner, preview._payloadRef!)).mdc).toEqual({
      context,
    });
  });

  it("restricts reads and releases to the owning window and supports idempotent cleanup", async () => {
    const owner = new Owner();
    const other = new Owner();
    const preview = await store.retain(
      owner,
      toEntry({ message: "x".repeat(200_000) }, "", "test"),
    );
    await expect(store.load(other, preview._payloadRef!)).rejects.toThrow(
      "another window",
    );
    await expect(store.release(other, [preview._payloadRef!])).rejects.toThrow(
      "another window",
    );
    await store.release(owner, [preview._payloadRef!]);
    await store.release(owner, [preview._payloadRef!]);
    await expect(store.load(owner, preview._payloadRef!)).rejects.toThrow(
      "unavailable",
    );
    expect(owner.listenerCount("destroyed")).toBe(0);
    expect(owner.listenerCount("render-process-gone")).toBe(0);
  });

  it("reclaims originals when their window is destroyed or its renderer crashes", async () => {
    for (const event of ["destroyed", "render-process-gone"]) {
      const owner = new Owner();
      const preview = await store.retain(
        owner,
        toEntry({ message: "x".repeat(200_000) }, "", "test"),
      );
      owner.emit(event);
      await vi.waitFor(() =>
        expect(
          owner.listenerCount("destroyed") +
            owner.listenerCount("render-process-gone"),
        ).toBe(0),
      );
      await expect(store.load(owner, preview._payloadRef!)).rejects.toThrow(
        "unavailable",
      );
    }
  });

  it("does not finish a payload after its window closes during preparation", async () => {
    const owner = new Owner();
    const pending = store.retain(
      owner,
      toEntry({ message: "x".repeat(200_000) }, "", "test"),
    );
    owner.destroy();
    await expect(pending).rejects.toThrow("closed");
    await store.close();
    expect(await readdir(directory)).toEqual([]);
  });

  it("retries directory creation after storage becomes available again", async () => {
    const parent = path.join(directory, "not-a-directory");
    await writeFile(parent, "occupied");
    const recovering = new EntryPayloadStore({ parentDirectory: parent });
    const owner = new Owner();
    const entry = toEntry({ message: "x".repeat(200_000) }, "", "test");
    try {
      await expect(recovering.retain(owner, entry)).rejects.toThrow();
      await rm(parent);
      await mkdir(parent);
      const preview = await recovering.retain(owner, entry);
      expect((await recovering.load(owner, preview._payloadRef!)).message).toBe(
        entry._fullMessage,
      );
    } finally {
      await recovering.close();
    }
  });

  it("cleans a failed batch without releasing originals already in use", async () => {
    const owner = new Owner();
    const entry = toEntry({ message: "x".repeat(200_000) }, "", "test");
    const retained = await store.retain(owner, entry);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await expect(
      store.prepare(owner, [retained, entry, { ...entry, raw: cycle }]),
    ).rejects.toThrow("circular");
    expect((await store.load(owner, retained._payloadRef!)).message).toBe(
      entry._fullMessage,
    );
    const [folder] = await readdir(directory);
    expect(await readdir(path.join(directory, folder!))).toHaveLength(1);
  });
});
