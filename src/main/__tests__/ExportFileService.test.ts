import { EventEmitter } from "node:events";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportFileService } from "../ExportFileService";
import { EXPORT_CHUNK_BYTES } from "../../types/ipc";

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

let dir: string;
beforeEach(async () => {
  dir = path.resolve(`.export-test-${randomUUID()}`);
  await mkdir(dir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("ExportFileService", () => {
  it("keeps an existing destination intact until flush/finish and cleans its handle", async () => {
    const service = new ExportFileService();
    const owner = new Owner();
    const file = path.join(dir, "export.json");
    await writeFile(file, "original");
    service.authorize(owner, file);
    const id = await service.begin(owner, file);
    await service.write(owner, id, 0, Buffer.from("["));
    await service.write(owner, id, 1, Buffer.from('"😀"]'));
    expect(await readFile(file, "utf8")).toBe("original");
    expect(await service.finish(owner, id, 2)).toBe(file);
    expect(await readFile(file, "utf8")).toBe('["😀"]');
    expect(await readdir(dir)).toEqual(["export.json"]);
    expect(owner.listenerCount("destroyed")).toBe(0);
    await expect(service.write(owner, id, 2, Buffer.from("x"))).rejects.toThrow(
      "Unknown",
    );
  });

  it("requires a single-use path selection by the owning window", async () => {
    const service = new ExportFileService();
    const owner = new Owner();
    const other = new Owner();
    const file = path.join(dir, "export");
    await expect(service.begin(owner, file)).rejects.toThrow("not selected");
    service.authorize(owner, file);
    await expect(service.begin(other, file)).rejects.toThrow("not selected");
    const id = await service.begin(owner, file);
    await expect(service.begin(owner, file)).rejects.toThrow("not selected");
    await expect(service.write(other, id, 0, Buffer.from("x"))).rejects.toThrow(
      "another window",
    );
    await expect(service.finish(other, id, 0)).rejects.toThrow(
      "another window",
    );
    await expect(service.cancel(other, id)).rejects.toThrow("another window");
    await service.cancel(owner, id);
    expect(await readdir(dir)).toEqual([]);
  });

  it.each(["index", "size", "count"] as const)(
    "rejects invalid %s and deletes partial files",
    async (kind) => {
      const service = new ExportFileService();
      const owner = new Owner();
      const file = path.join(dir, "export");
      service.authorize(owner, file);
      const id = await service.begin(owner, file);
      const pending =
        kind === "count"
          ? service.finish(owner, id, 1)
          : service.write(
              owner,
              id,
              kind === "index" ? 2 : 0,
              Buffer.alloc(kind === "size" ? EXPORT_CHUNK_BYTES + 1 : 1),
            );
      await expect(pending).rejects.toThrow();
      expect(await readdir(dir)).toEqual([]);
      await service.cancel(owner, id);
    },
  );

  it("rejects concurrent writes instead of queuing unbounded chunks", async () => {
    const service = new ExportFileService();
    const owner = new Owner();
    const file = path.join(dir, "export");
    service.authorize(owner, file);
    const id = await service.begin(owner, file);
    const first = service.write(owner, id, 0, Buffer.from("one"));
    await expect(
      service.write(owner, id, 1, Buffer.from("two")),
    ).rejects.toThrow("in progress");
    await first;
    await service.cancel(owner, id);
  });

  it("cleans partial exports when the renderer is destroyed", async () => {
    const errors = vi.fn();
    const service = new ExportFileService(errors);
    const owner = new Owner();
    const file = path.join(dir, "export");
    service.authorize(owner, file);
    const id = await service.begin(owner, file);
    await service.write(owner, id, 0, Buffer.from("partial"));
    owner.destroy();
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
    expect(owner.listenerCount("destroyed")).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });

  it("cleans up if destruction races opening the partial file", async () => {
    const service = new ExportFileService();
    const owner = new Owner();
    const file = path.join(dir, "export");
    service.authorize(owner, file);
    const pending = service.begin(owner, file);
    owner.destroy();
    await expect(pending).rejects.toThrow("canceled");
    expect(await readdir(dir)).toEqual([]);
  });

  it("preserves existing destination and removes partial file when rename fails", async () => {
    const service = new ExportFileService();
    const owner = new Owner();
    const file = path.join(dir, "directory");
    await mkdir(file);
    service.authorize(owner, file);
    const id = await service.begin(owner, file);
    await service.write(owner, id, 0, Buffer.from("data"));
    await expect(service.finish(owner, id, 1)).rejects.toThrow();
    expect(await readdir(dir)).toEqual(["directory"]);
  });

  it("propagates open failures and releases lifecycle listeners", async () => {
    const service = new ExportFileService();
    const owner = new Owner();
    const file = path.join(dir, "missing", "file");
    service.authorize(owner, file);
    await expect(service.begin(owner, file)).rejects.toThrow();
    expect(owner.listenerCount("destroyed")).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it.each(["write", "sync"] as const)(
    "surfaces file-handle %s failures and preserves the target",
    async (operation) => {
      const service = new ExportFileService();
      const owner = new Owner();
      const file = path.join(dir, "export");
      await writeFile(file, "original");
      const probe = await open(file, "r");
      const prototype: object = Object.getPrototypeOf(probe);
      await probe.close();
      service.authorize(owner, file);
      const id = await service.begin(owner, file);
      if (operation === "sync")
        await service.write(owner, id, 0, Buffer.from("new"));
      vi.spyOn(
        prototype as {
          write: () => Promise<unknown>;
          sync: () => Promise<void>;
        },
        operation,
      ).mockRejectedValue(new Error("disk failure"));
      await expect(
        operation === "write"
          ? service.write(owner, id, 0, Buffer.from("new"))
          : service.finish(owner, id, 1),
      ).rejects.toThrow("disk failure");
      expect(await readFile(file, "utf8")).toBe("original");
      expect(await readdir(dir)).toEqual(["export"]);
      expect(owner.listenerCount("destroyed")).toBe(0);
    },
  );

  it("aborts a write in progress without publishing a partial destination", async () => {
    const service = new ExportFileService();
    const owner = new Owner();
    const file = path.join(dir, "export");
    service.authorize(owner, file);
    const id = await service.begin(owner, file);
    const writing = service.write(
      owner,
      id,
      0,
      Buffer.alloc(EXPORT_CHUNK_BYTES),
    );
    const canceling = service.cancel(owner, id);
    await expect(writing).rejects.toThrow("canceled");
    await canceling;
    expect(await readdir(dir)).toEqual([]);
  });

  it("cleans up after renderer process termination without window destruction", async () => {
    const service = new ExportFileService();
    const owner = new Owner();
    const file = path.join(dir, "export");
    service.authorize(owner, file);
    await service.begin(owner, file);
    owner.emit("render-process-gone");
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([]));
    expect(owner.listenerCount("destroyed")).toBe(0);
    expect(owner.listenerCount("render-process-gone")).toBe(0);
  });
});
