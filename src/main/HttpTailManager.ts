/**
 * HttpTailManager – incremental HTTP tail for endpoints that support
 * `Range: bytes=<offset>-` requests (e.g. Spring Boot Actuator's
 * `/actuator/logfile`).
 *
 * Why not just reuse the regular HTTP polling?
 *   The existing poller re-downloads the full body on every tick and uses
 *   per-entry deduplication. For multi-MB log files that is wasteful and
 *   slow. The tail mode here only transfers *new* bytes since the last poll
 *   by issuing a Range request and remembering the offset.
 *
 * Design:
 *   - Pure class, no Electron deps → directly unit-testable with a local
 *     `http.createServer()` in tests.
 *   - One state per tail (id, url, offset, partial-line buffer, timer).
 *   - First tick discovers current size; subsequent ticks ask for
 *     `bytes=<offset>-`.
 *   - Rotation detection: if the server reports a total size smaller than
 *     our offset (416 Range-Not-Satisfiable, or 200 with smaller body), we
 *     reset offset to 0 and emit the new content.
 *   - Lines are split + CR-stripped exactly like {@link splitLines} in
 *     FileWatcher, with partial-line buffering.
 */

export interface HttpTailCallbacks {
  /** Called whenever new complete lines are available. */
  onLines: (lines: string[]) => void;
  /** Called when the tail detected a rotation (offset reset to 0). */
  onRotated?: () => void;
  /** Called on transport-level errors (network failure, parse failure). */
  onError?: (err: Error) => void;
  /**
   * Called once per tick with the latest known total size in bytes (if the
   * server provided it via `Content-Length` / `Content-Range`).
   * Useful for status indicators in the UI.
   */
  onProgress?: (info: { offset: number; total?: number }) => void;
}

export interface HttpTailOptions {
  /** Polling interval in ms. Defaults to 2000. Minimum 250. */
  intervalMs?: number;
  /**
   * If true, emits the existing content of the file on first tick.
   * If false (default), starts tailing from the current end – i.e. only
   * new content appended after the tail started is delivered.
   */
  emitInitial?: boolean;
  /** Additional HTTP headers (e.g. `Authorization`). */
  headers?: Record<string, string>;
  /**
   * Allow self-signed / invalid TLS certificates (development servers).
   * Mirrors the `allowInsecureSSL` option of the regular HTTP poller.
   */
  allowInsecureSSL?: boolean;
  /** Per-request timeout in ms. Defaults to 15_000. */
  timeoutMs?: number;
  /** Override fetch impl (for tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

interface TailState {
  id: number;
  url: string;
  offset: number;
  /** Partial last line that didn't end with a newline. */
  partial: string;
  timer: NodeJS.Timeout | null;
  abort: AbortController | null;
  stopped: boolean;
  intervalMs: number;
  headers: Record<string, string>;
  allowInsecureSSL: boolean;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  callbacks: HttpTailCallbacks;
}

/**
 * Splits a chunk of text into complete lines, stripping trailing CR and
 * dropping the empty trailing element. The caller is responsible for
 * buffering any partial last line across reads.
 */
export function splitTailLines(input: string): string[] {
  if (input.length === 0) return [];
  const parts = input.split("\n");
  const out: string[] = [];
  for (const part of parts) {
    out.push(part.endsWith("\r") ? part.slice(0, -1) : part);
  }
  // If input ended on a newline, the last element will be "" → drop it.
  if (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

export class HttpTailManager {
  private nextId = 1;
  private tails = new Map<number, TailState>();

  list(): Array<{ id: number; url: string; offset: number }> {
    return [...this.tails.values()].map((t) => ({
      id: t.id,
      url: t.url,
      offset: t.offset,
    }));
  }

  stop(id: number): boolean {
    const t = this.tails.get(id);
    if (!t) return false;
    t.stopped = true;
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    if (t.abort) {
      try {
        t.abort.abort();
      } catch {
        // ignore
      }
    }
    this.tails.delete(id);
    return true;
  }

  stopAll(): void {
    for (const id of [...this.tails.keys()]) this.stop(id);
  }

  start(
    url: string,
    callbacks: HttpTailCallbacks,
    options: HttpTailOptions = {},
  ): { id: number; url: string } {
    if (!url || typeof url !== "string") {
      throw new Error("url required");
    }
    // Cheap validation – let fetch fail later for protocol mismatches.
    try {
      new URL(url);
    } catch {
      throw new Error("invalid url: " + url);
    }
    const id = this.nextId++;
    const intervalMs = Math.max(250, options.intervalMs ?? 2000);
    const state: TailState = {
      id,
      url,
      offset: 0,
      partial: "",
      timer: null,
      abort: null,
      stopped: false,
      intervalMs,
      headers: options.headers ?? {},
      allowInsecureSSL: !!options.allowInsecureSSL,
      timeoutMs: options.timeoutMs ?? 15_000,
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
      callbacks,
    };
    this.tails.set(id, state);

    // Kick off discovery + first tick asynchronously.
    void this.runInitial(state, !!options.emitInitial);
    return { id, url };
  }

  /** Discover starting offset (and optionally emit existing content). */
  private async runInitial(
    state: TailState,
    emitInitial: boolean,
  ): Promise<void> {
    try {
      if (emitInitial) {
        // Fetch the full body, emit everything, then advance offset.
        await this.fetchAndEmit(state, /*fromOffset=*/ 0);
      } else {
        // Discover size only: HEAD request. If HEAD is not supported,
        // fall back to a tiny range GET (bytes=0-0) – every Range-aware
        // server responds with `Content-Range: bytes 0-0/<total>`.
        const total = await this.discoverSize(state);
        if (total != null) {
          state.offset = total;
          state.callbacks.onProgress?.({ offset: total, total });
        }
      }
    } catch (err) {
      // Swallow abort errors triggered by stop() – the user explicitly
      // requested termination and shouldn't see a misleading "AbortError"
      // toast in the renderer.
      if (!state.stopped) {
        state.callbacks.onError?.(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } finally {
      this.scheduleNext(state);
    }
  }

  private scheduleNext(state: TailState): void {
    if (state.stopped) return;
    state.timer = setTimeout(() => {
      void this.tick(state);
    }, state.intervalMs);
  }

  private async tick(state: TailState): Promise<void> {
    if (state.stopped) return;
    try {
      await this.fetchAndEmit(state, state.offset);
    } catch (err) {
      if (!state.stopped) {
        state.callbacks.onError?.(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } finally {
      this.scheduleNext(state);
    }
  }

  /**
   * Performs one Range request starting at `fromOffset` and emits any new
   * lines. Updates `state.offset` on success.
   */
  private async fetchAndEmit(
    state: TailState,
    fromOffset: number,
  ): Promise<void> {
    const ac = new AbortController();
    state.abort = ac;
    const timeout = setTimeout(() => ac.abort(), state.timeoutMs);
    try {
      const headers: Record<string, string> = {
        ...state.headers,
        Accept: state.headers.Accept ?? "text/plain, */*",
      };
      // Only use a Range header when starting beyond byte 0; this keeps the
      // initial full-fetch path symmetric with non-range-aware servers.
      if (fromOffset > 0) {
        headers.Range = `bytes=${String(fromOffset)}-`;
      }
      const res = await state.fetchImpl(state.url, {
        method: "GET",
        headers,
        signal: ac.signal,
        // @ts-expect-error – Node's undici accepts this dispatcher option for
        // self-signed certs; ignored in browser environments / tests.
        rejectUnauthorized: state.allowInsecureSSL ? false : undefined,
      });

      // 416 Range Not Satisfiable can mean two very different things:
      //   (a) the file shrank below our offset (real rotation), OR
      //   (b) we are simply at EOF (offset === total, no new bytes yet).
      // Disambiguate via a size probe before resetting.
      if (res.status === 416) {
        const probed = await this.discoverSize(state);
        if (probed != null && probed < fromOffset) {
          if (!state.stopped) state.callbacks.onRotated?.();
          state.offset = 0;
          state.partial = "";
        }
        // If probed >= offset (or unknown) → still at EOF, just wait.
        state.callbacks.onProgress?.({ offset: state.offset, total: probed });
        return;
      }
      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${String(res.status)} ${res.statusText}`);
      }

      const total = parseTotalFromHeaders(res);
      const text = await res.text();

      // 200 OK on a Range request usually means the server ignored the
      // Range header (no Range support). In that case `text` is the full
      // body, and we have to detect rotation manually.
      const isFullResponse = res.status === 200 && fromOffset > 0;
      if (isFullResponse) {
        if (text.length < fromOffset) {
          // Body shrank → rotation. Emit full text from byte 0.
          if (!state.stopped) state.callbacks.onRotated?.();
          state.offset = 0;
          state.partial = "";
          this.consume(state, text);
          state.offset = text.length;
        } else {
          // Body grew – emit only the slice past our offset.
          const newPart = text.slice(fromOffset);
          this.consume(state, newPart);
          state.offset = text.length;
        }
      } else {
        // 206 Partial Content (or initial 200 with fromOffset===0).
        this.consume(state, text);
        state.offset = fromOffset + text.length;
      }
      state.callbacks.onProgress?.({ offset: state.offset, total });
    } finally {
      clearTimeout(timeout);
      state.abort = null;
    }
  }

  /**
   * HEAD-then-GET fallback discovery of total size in bytes. Returns
   * `undefined` if the server doesn't expose a length and doesn't honour
   * Range requests.
   */
  private async discoverSize(state: TailState): Promise<number | undefined> {
    const ac = new AbortController();
    // Register so HttpTailManager.stop() can abort an in-flight discovery
    // (important when the URL is unreachable and we'd otherwise wait for the
    // 15s default timeout before the manager actually shuts down).
    state.abort = ac;
    const timeout = setTimeout(() => ac.abort(), state.timeoutMs);
    try {
      // Try HEAD first.
      try {
        const head = await state.fetchImpl(state.url, {
          method: "HEAD",
          headers: state.headers,
          signal: ac.signal,
        });
        if (head.ok) {
          const len = head.headers.get("content-length");
          if (len != null) {
            const n = Number.parseInt(len, 10);
            if (Number.isFinite(n) && n >= 0) return n;
          }
        }
      } catch {
        // Some servers (or fetch impls) don't allow HEAD – fall through.
      }
      // Fallback: range GET bytes=0-0
      const probe = await state.fetchImpl(state.url, {
        method: "GET",
        headers: { ...state.headers, Range: "bytes=0-0" },
        signal: ac.signal,
      });
      if (probe.status === 206) {
        const cr = probe.headers.get("content-range");
        if (cr) {
          // Format: "bytes 0-0/12345"
          const slash = cr.lastIndexOf("/");
          if (slash > 0) {
            const totalStr = cr.slice(slash + 1).trim();
            if (totalStr !== "*") {
              const n = Number.parseInt(totalStr, 10);
              if (Number.isFinite(n) && n >= 0) {
                // Drain the 1-byte body to free the connection.
                await probe.text();
                return n;
              }
            }
          }
        }
        await probe.text();
      } else if (probe.ok) {
        // No Range support – fall back to full GET, return body length.
        const text = await probe.text();
        return text.length;
      }
    } finally {
      clearTimeout(timeout);
      state.abort = null;
    }
    return undefined;
  }

  /** Buffer + line-split + emit. */
  private consume(state: TailState, chunk: string): void {
    if (chunk.length === 0) return;
    const combined = state.partial + chunk;
    const lastNl = combined.lastIndexOf("\n");
    if (lastNl < 0) {
      // No complete line yet – buffer.
      state.partial = combined;
      return;
    }
    const complete = combined.slice(0, lastNl + 1);
    state.partial = combined.slice(lastNl + 1);
    const lines = splitTailLines(complete);
    if (lines.length > 0) state.callbacks.onLines(lines);
  }
}

function parseTotalFromHeaders(res: Response): number | undefined {
  const cr = res.headers.get("content-range");
  if (cr) {
    const slash = cr.lastIndexOf("/");
    if (slash > 0) {
      const totalStr = cr.slice(slash + 1).trim();
      if (totalStr !== "*") {
        const n = Number.parseInt(totalStr, 10);
        if (Number.isFinite(n) && n >= 0) return n;
      }
    }
  }
  const cl = res.headers.get("content-length");
  if (cl != null) {
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}
