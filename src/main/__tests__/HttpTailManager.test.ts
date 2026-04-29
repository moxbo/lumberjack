import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http from "http";
import type { AddressInfo } from "net";
import { HttpTailManager, splitTailLines } from "../HttpTailManager";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A tiny in-memory file served over HTTP with proper Range support. */
class FakeServer {
  server!: http.Server;
  body = "";
  hits: Array<{ method: string; range?: string }> = [];
  /** If true, the server ignores Range headers and always returns 200 + full body. */
  ignoreRange = false;
  /** If true, HEAD returns 405. */
  blockHead = false;

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => {
      this.hits.push({ method: req.method ?? "?", range: req.headers.range });
      if (req.method === "HEAD") {
        if (this.blockHead) {
          res.statusCode = 405;
          res.end();
          return;
        }
        res.setHeader("Content-Length", String(Buffer.byteLength(this.body)));
        res.setHeader("Accept-Ranges", "bytes");
        res.end();
        return;
      }
      const range = !this.ignoreRange ? req.headers.range : undefined;
      const total = Buffer.byteLength(this.body);
      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range)!;
        const startStr = m[1] ?? "";
        const endStr = m[2] ?? "";
        const start = startStr === "" ? 0 : Number.parseInt(startStr, 10);
        const end = endStr === "" ? total - 1 : Number.parseInt(endStr, 10);
        if (start >= total) {
          res.statusCode = 416;
          res.end();
          return;
        }
        const slice = this.body.slice(start, Math.min(end, total - 1) + 1);
        res.statusCode = 206;
        res.setHeader(
          "Content-Range",
          `bytes ${String(start)}-${String(start + slice.length - 1)}/${String(total)}`,
        );
        res.setHeader("Content-Length", String(Buffer.byteLength(slice)));
        res.end(slice);
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Length", String(total));
      res.end(this.body);
    });
    await new Promise<void>((resolve) =>
      this.server.listen(0, "127.0.0.1", resolve),
    );
    const addr = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${String(addr.port)}/log`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

describe("splitTailLines", () => {
  it("splits, strips CR, drops trailing empty line", () => {
    expect(splitTailLines("a\nb\r\nc\n")).toEqual(["a", "b", "c"]);
  });
  it("keeps single line without newline", () => {
    expect(splitTailLines("only")).toEqual(["only"]);
  });
  it("returns empty for empty input", () => {
    expect(splitTailLines("")).toEqual([]);
  });
});

describe("HttpTailManager", () => {
  let server: FakeServer;
  let url: string;

  beforeEach(async () => {
    server = new FakeServer();
    url = await server.start();
  });
  afterEach(async () => {
    await server.stop();
  });

  it("does not emit existing content by default; only newly appended bytes", async () => {
    server.body = "old1\nold2\n";
    const mgr = new HttpTailManager();
    const received: string[] = [];
    mgr.start(
      url,
      { onLines: (l) => received.push(...l) },
      { intervalMs: 250 },
    );

    await delay(400); // initial discovery + at least one tick
    server.body += "new1\nnew2\n";
    await delay(400);

    mgr.stopAll();
    expect(received).toEqual(["new1", "new2"]);
  });

  it("emits initial content when emitInitial=true", async () => {
    server.body = "first\nsecond\n";
    const mgr = new HttpTailManager();
    const received: string[] = [];
    mgr.start(
      url,
      { onLines: (l) => received.push(...l) },
      { intervalMs: 1000, emitInitial: true },
    );
    await delay(300);
    mgr.stopAll();
    expect(received).toEqual(["first", "second"]);
  });

  it("buffers partial last line across ticks", async () => {
    server.body = "";
    const mgr = new HttpTailManager();
    const received: string[] = [];
    mgr.start(
      url,
      { onLines: (l) => received.push(...l) },
      { intervalMs: 250 },
    );
    await delay(300);

    server.body = "partial";
    await delay(400);
    expect(received).toEqual([]);

    server.body += "-rest\n";
    await delay(500);

    mgr.stopAll();
    expect(received).toEqual(["partial-rest"]);
  });

  it("detects rotation via 416 (server reports smaller size)", async () => {
    server.body = "before-rotation\nold\n";
    const mgr = new HttpTailManager();
    const received: string[] = [];
    let rotated = 0;
    mgr.start(
      url,
      {
        onLines: (l) => received.push(...l),
        onRotated: () => {
          rotated++;
        },
      },
      { intervalMs: 250 },
    );
    await delay(400);

    server.body = "after\n"; // shorter → 416 next tick
    await delay(700);

    mgr.stopAll();
    expect(rotated).toBeGreaterThanOrEqual(1);
    expect(received).toContain("after");
  });

  it("works with servers that ignore Range headers (full re-fetch fallback)", async () => {
    server.ignoreRange = true;
    server.body = "a\nb\n";
    const mgr = new HttpTailManager();
    const received: string[] = [];
    mgr.start(
      url,
      { onLines: (l) => received.push(...l) },
      { intervalMs: 250 },
    );

    await delay(400);
    server.body += "c\nd\n";
    await delay(500);

    mgr.stopAll();
    // Without Range, the manager still detects new content via length diff.
    expect(received).toEqual(["c", "d"]);
  });

  it("falls back to range-probe when HEAD is not supported", async () => {
    server.blockHead = true;
    server.body = "x\ny\n";
    const mgr = new HttpTailManager();
    const received: string[] = [];
    mgr.start(
      url,
      { onLines: (l) => received.push(...l) },
      { intervalMs: 250 },
    );
    await delay(400);
    server.body += "z\n";
    await delay(400);
    mgr.stopAll();
    expect(received).toEqual(["z"]);
  });

  it("list() and stop() track active tails", () => {
    server.body = "";
    const mgr = new HttpTailManager();
    const t = mgr.start(url, { onLines: () => {} }, { intervalMs: 5000 });
    expect(mgr.list()).toHaveLength(1);
    expect(mgr.list()[0]?.url).toBe(url);
    expect(mgr.stop(t.id)).toBe(true);
    expect(mgr.list()).toHaveLength(0);
    expect(mgr.stop(t.id)).toBe(false);
  });

  it("rejects invalid url", () => {
    const mgr = new HttpTailManager();
    expect(() => mgr.start("not a url", { onLines: () => {} })).toThrow();
  });

  it("reports progress with offset/total", async () => {
    server.body = "abc\n";
    const mgr = new HttpTailManager();
    const seen: Array<{ offset: number; total?: number }> = [];
    mgr.start(
      url,
      {
        onLines: () => {},
        onProgress: (p) => seen.push(p),
      },
      { intervalMs: 250 },
    );
    await delay(500);
    mgr.stopAll();
    expect(seen.length).toBeGreaterThan(0);
    // Initial discovery (HEAD) gives us total = 4 with offset=4 (tail mode).
    const last = seen[seen.length - 1]!;
    expect(last.offset).toBeGreaterThanOrEqual(4);
  });
});
