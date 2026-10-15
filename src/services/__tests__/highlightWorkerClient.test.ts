import { afterEach, describe, expect, it, vi } from "vitest";
import { requestHighlight } from "../highlightWorkerClient";
import { escapeHtml, highlightAll } from "../../utils/highlight";

afterEach(() => vi.unstubAllGlobals());

describe("highlightWorkerClient", () => {
  it("keeps a large original complete without sending or retaining it in the highlight worker", async () => {
    const worker = vi.fn();
    vi.stubGlobal("Worker", worker);
    const text = "<xml>" + "x".repeat(1024 * 1024) + "<tail>&</tail></xml>";
    await expect(requestHighlight(text, "tail")).resolves.toBe(
      escapeHtml(text),
    );
    expect(worker).not.toHaveBeenCalled();
  });

  it("returns exactly the shared highlightAll output", async () => {
    const text = '<error id="42">failure & retry</error>';
    const search = "error|failure";

    await expect(requestHighlight(text, search)).resolves.toBe(
      highlightAll(text, search),
    );
  });

  it("deduplicates equivalent queued requests without changing output", async () => {
    const text = "same long message ".repeat(200);
    const search = "message";

    const [first, second] = await Promise.all([
      requestHighlight(text, search),
      requestHighlight(text, search),
    ]);

    expect(first).toBe(highlightAll(text, search));
    expect(second).toBe(first);
  });
});
