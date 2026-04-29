import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { splitLines, WatchManager } from "../FileWatcher";

/**
 * NOTE: fs.watchFile uses polling, so tests need a small wait. We keep these
 * tests narrowly focused on offset/line-splitting/rotation logic.
 */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("splitLines", () => {
  it("strips trailing CR on each line and drops empty trailing line", () => {
    expect(splitLines("a\nb\r\nc\n")).toEqual(["a", "b", "c"]);
  });
  it("returns single line for input without newline", () => {
    expect(splitLines("only")).toEqual(["only"]);
  });
});

describe("WatchManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumber-watch-"));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("delivers only newly-appended lines (no initial emit by default)", async () => {
    const file = path.join(tmpDir, "a.log");
    fs.writeFileSync(file, "old1\nold2\n");

    const received: string[] = [];
    const mgr = new WatchManager();
    const w = mgr.start(
      file,
      { onLines: (lines) => received.push(...lines) },
      { pollIntervalMs: 100 },
    );

    // Append new content
    await delay(150);
    fs.appendFileSync(file, "new1\nnew2\n");
    // Wait for at least one poll cycle
    await delay(400);

    mgr.stop(w.id);
    expect(received).toEqual(["new1", "new2"]);
  });

  it("emits initial content when emitInitial=true", async () => {
    const file = path.join(tmpDir, "b.log");
    fs.writeFileSync(file, "first\nsecond\n");

    const received: string[] = [];
    const mgr = new WatchManager();
    const w = mgr.start(
      file,
      { onLines: (lines) => received.push(...lines) },
      { pollIntervalMs: 100, emitInitial: true },
    );

    // emitInitial triggers an immediate read
    await delay(150);
    mgr.stop(w.id);
    expect(received).toEqual(["first", "second"]);
  });

  it("buffers partial lines across reads (no premature emit without newline)", async () => {
    const file = path.join(tmpDir, "c.log");
    fs.writeFileSync(file, "");

    const received: string[] = [];
    const mgr = new WatchManager();
    const w = mgr.start(
      file,
      { onLines: (lines) => received.push(...lines) },
      { pollIntervalMs: 100 },
    );

    fs.appendFileSync(file, "partial");
    await delay(250);
    expect(received).toEqual([]);

    fs.appendFileSync(file, "-rest\n");
    await delay(300);

    mgr.stop(w.id);
    expect(received).toEqual(["partial-rest"]);
  });

  it("detects truncation and notifies via onRotated", async () => {
    const file = path.join(tmpDir, "d.log");
    fs.writeFileSync(file, "before-rotation\n");

    const received: string[] = [];
    let rotated = 0;
    const mgr = new WatchManager();
    const w = mgr.start(
      file,
      {
        onLines: (lines) => received.push(...lines),
        onRotated: () => {
          rotated++;
        },
      },
      { pollIntervalMs: 100 },
    );

    // Truncate + write fresh content
    await delay(150);
    fs.writeFileSync(file, "after-rotation\n");
    await delay(400);

    mgr.stop(w.id);
    expect(rotated).toBeGreaterThanOrEqual(1);
    expect(received).toContain("after-rotation");
  });

  it("list() returns active watchers and stop() removes them", () => {
    const file = path.join(tmpDir, "e.log");
    fs.writeFileSync(file, "");
    const mgr = new WatchManager();
    const w = mgr.start(file, { onLines: () => {} });
    expect(mgr.list()).toHaveLength(1);
    expect(mgr.list()[0]?.filePath).toBe(file);
    expect(mgr.stop(w.id)).toBe(true);
    expect(mgr.list()).toHaveLength(0);
    expect(mgr.stop(w.id)).toBe(false);
  });

  it("throws when path is not a regular file", () => {
    const mgr = new WatchManager();
    expect(() => mgr.start(tmpDir, { onLines: () => {} })).toThrow();
  });
});
