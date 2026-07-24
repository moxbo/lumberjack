import { describe, expect, it } from "vitest";
import { requestHighlight } from "../highlightWorkerClient";
import { highlightAll } from "../../utils/highlight";

describe("highlightWorkerClient", () => {
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
