import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { once } from "events";
import { connect } from "net";
import {
  AsyncFileWriter,
  FileWriterBackpressureError,
} from "../AsyncFileWriter";
import { FileLoggingService } from "../FileLoggingService";
import { NetworkService } from "../NetworkService";

vi.mock("electron-log/main", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("serialized file logging", () => {
  let directory: string;
  let filepath: string;

  beforeEach(async () => {
    directory = path.join(process.cwd(), `.file-logging-test-${randomUUID()}`);
    filepath = path.join(directory, "entries.log");
    await fs.promises.mkdir(directory);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.promises.rm(directory, { recursive: true, force: true });
  });

  const configuration = (filepath: string, maxBytes = 8, maxBackups = 2) => ({
    filepath,
    enabled: true,
    maxBytes,
    maxBackups,
  });

  it("waits for pending writes before rotating and counts UTF-8 bytes", async () => {
    const service = new FileLoggingService();
    await service.configure(configuration(filepath, 4));
    const release = deferred();
    const started = deferred();
    const append = fs.promises.appendFile.bind(fs.promises);
    vi.spyOn(fs.promises, "appendFile").mockImplementationOnce(
      async (...args) => {
        started.resolve();
        await release.promise;
        await append(...args);
      },
    );
    const rename = vi.spyOn(fs.promises, "rename");
    const first = service.write("éé");
    await started.promise;
    const second = service.write("x");
    await Promise.resolve();
    expect(rename).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([first, second, service.close()]);
    expect(await fs.promises.readFile(`${filepath}.1`, "utf8")).toBe("éé");
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("x");
    expect(service.getStats()).toMatchObject({
      bytesWritten: 5,
      writeCount: 2,
    });
  });

  it("orders explicit rotation, path changes, disabling and shutdown", async () => {
    const service = new FileLoggingService();
    const other = path.join(directory, "other.log");
    await service.configure(configuration(filepath));
    const operations = [
      service.write("before"),
      service.rotate(),
      service.write("after"),
      service.configure(configuration(other)),
      service.write("new"),
      service.configure({ ...configuration(other), enabled: false }),
      service.write("disabled"),
      service.close(),
    ];
    await Promise.all(operations);
    expect(await fs.promises.readFile(`${filepath}.1`, "utf8")).toBe("before");
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("after");
    expect(await fs.promises.readFile(other, "utf8")).toBe("new");
    expect(service.isBusy()).toBe(false);
    await expect(service.write("late")).rejects.toThrow("closed");
    await expect(service.configure(configuration(filepath))).rejects.toThrow(
      "closed",
    );
  });

  it("keeps existing file sizes and backup order, including zero backups", async () => {
    await fs.promises.writeFile(filepath, "1234");
    const service = new FileLoggingService();
    await service.configure(configuration(filepath, 4));
    await service.write("abcd");
    await service.write("efgh");
    await service.close();
    expect(await fs.promises.readFile(`${filepath}.2`, "utf8")).toBe("1234");
    expect(await fs.promises.readFile(`${filepath}.1`, "utf8")).toBe("abcd");
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("efgh");
    const noBackups = new FileLoggingService();
    await noBackups.configure(configuration(filepath, 4, 0));
    await noBackups.write("more");
    await noBackups.close();
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("efghmore");
  });

  it("rejects write and flush on I/O failure, then continues the queue", async () => {
    const service = new FileLoggingService();
    await service.configure(configuration(filepath));
    vi.spyOn(fs.promises, "appendFile").mockRejectedValueOnce(
      new Error("disk full"),
    );
    await expect(service.write("bad")).rejects.toThrow("disk full");
    await service.write("good");
    await expect(service.flush()).rejects.toThrow("disk full");
    await service.close();
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("good");
    expect(service.getStats().bytesWritten).toBe(4);
  });

  it("rejects rotation errors without appending into the wrong generation", async () => {
    const service = new FileLoggingService();
    await service.configure(configuration(filepath, 4, 1));
    await service.write("1234");
    vi.spyOn(fs.promises, "rename").mockRejectedValueOnce(
      new Error("rename denied"),
    );
    await expect(service.write("x")).rejects.toThrow("rename denied");
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("1234");
    await expect(service.close()).rejects.toThrow("rename denied");
  });

  it("does not fall back to the old path after a configure failure", async () => {
    const service = new FileLoggingService();
    await service.configure(configuration(filepath));
    await service.write("old");
    const invalid = path.join(filepath, "not-a-directory.log");
    await expect(service.configure(configuration(invalid))).rejects.toThrow();
    await expect(service.write("wrong")).rejects.toThrow();
    await expect(service.close()).rejects.toThrow();
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("old");
  });

  it("bounds outstanding bytes and writes with explicit backpressure", async () => {
    const writer = new AsyncFileWriter(filepath, {
      maxQueuedBytes: 4,
      maxQueuedWrites: 2,
    });
    const first = writer.write("éé");
    await expect(writer.write("x")).rejects.toBeInstanceOf(
      FileWriterBackpressureError,
    );
    await first;
    await expect(writer.write("oversized")).rejects.toBeInstanceOf(
      FileWriterBackpressureError,
    );
    await writer.write("next");
    const a = writer.write("");
    const b = writer.write("");
    await expect(writer.write("")).rejects.toBeInstanceOf(
      FileWriterBackpressureError,
    );
    await Promise.all([a, b]);
    await expect(writer.flush()).rejects.toBeInstanceOf(
      FileWriterBackpressureError,
    );
    await writer.close();
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("éénext");
  });

  it("persists more than 256 concurrent writes by default without admission drops", async () => {
    const service = new FileLoggingService();
    await service.configure(configuration(filepath, Infinity));
    const chunks = Array.from({ length: 300 }, (_, i) => `${i}:é\n`);
    await Promise.all([
      ...chunks.map((chunk) => service.write(chunk)),
      service.close(),
    ]);
    expect(await fs.promises.readFile(filepath, "utf8")).toBe(chunks.join(""));
    expect(service.getStats().writeCount).toBe(300);
  });

  it("admits bounded pending data by default", async () => {
    const writer = new AsyncFileWriter(filepath);
    const chunk = "x".repeat(5 * 1024 * 1024);
    await Promise.all([
      writer.write(chunk),
      writer.write(chunk),
      writer.close(),
    ]);
    expect((await fs.promises.stat(filepath)).size).toBe(10 * 1024 * 1024);
  });

  it("persists the final TCP line when sources stop before the writer closes", async () => {
    const writer = new AsyncFileWriter(filepath);
    const network = new NetworkService();
    const parsed = deferred();
    const writes: Promise<void>[] = [];
    const errors: unknown[] = [];
    network.setParsers({
      parseJsonFile: () => [],
      parseTextLines: () => [],
      toEntry: (entry, _fallback, source) => {
        parsed.resolve();
        return { timestamp: null, message: String(entry.message), source };
      },
    });
    network.setLogCallback((entries) => {
      const write = writer
        .write(entries.map((entry) => entry.message + "\n").join(""))
        .catch((error: unknown) => {
          errors.push(error);
        });
      writes.push(write);
      return write;
    });
    const status = await network.startTcpServer(0);
    expect(status.ok).toBe(true);
    const socket = connect({ port: status.port!, host: "127.0.0.1" });
    socket.resume();
    try {
      await once(socket, "connect");
      socket.write("complete\ntrailing");
      await parsed.promise;
      network.stopAllHttpPollers();
      await network.stopTcpServer();
      await writer.close();
      await Promise.all(writes);
      expect(errors).toEqual([]);
      expect(await fs.promises.readFile(filepath, "utf8")).toBe(
        "complete\ntrailing\n",
      );
    } finally {
      socket.destroy();
      await network.stopTcpServer();
      await writer.close();
    }
  });

  it("close waits for accepted writes and is idempotent", async () => {
    const writer = new AsyncFileWriter(filepath);
    const release = deferred();
    const started = deferred();
    const append = fs.promises.appendFile.bind(fs.promises);
    vi.spyOn(fs.promises, "appendFile").mockImplementationOnce(
      async (...args) => {
        started.resolve();
        await release.promise;
        await append(...args);
      },
    );
    const first = writer.write("first");
    await started.promise;
    const second = writer.write("second");
    const close = writer.close();
    expect(writer.close()).toBe(close);
    await expect(writer.write("late")).rejects.toThrow("closed");
    let closed = false;
    void close.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release.resolve();
    await Promise.all([first, second, close]);
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("firstsecond");
  });

  it("clearQueue rejects queued writes rather than silently resolving them", async () => {
    const writer = new AsyncFileWriter(filepath);
    const queued = writer.write("cancelled");
    writer.clearQueue();
    await expect(queued).rejects.toThrow("queue cleared");
    await expect(writer.flush()).rejects.toThrow("queue cleared");
    await writer.write("kept");
    await writer.close();
    expect(await fs.promises.readFile(filepath, "utf8")).toBe("kept");
  });
});
