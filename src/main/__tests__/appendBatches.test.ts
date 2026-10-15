import { describe, expect, it } from "vitest";
import type { LogEntry } from "../../types/ipc";
import { WindowAppendQueue } from "../../services/WindowAppendQueue";
import { prepareAppendBatch, renderBatches } from "../util/appendBatches";
import { MAX_BATCH_ENTRIES } from "../util/constants";
import { getAppendFailureGroup } from "../util/appendDelivery";
import { isLiveAppendRejection } from "../../utils/appendRejection";

const entry: LogEntry = {
  timestamp: null,
  message: "line",
  source: "test",
};

describe("append transport provenance", () => {
  it("isolates only explicitly classified rejections of homogeneous live batches", () => {
    const live = { ...entry, _ingestionKind: "live" as const };
    const imported = { ...entry, _ingestionKind: "import" as const };
    expect(getAppendFailureGroup([live], "live-entry-limit")).toBe("live");
    expect(getAppendFailureGroup([live])).toBeUndefined();
    expect(
      getAppendFailureGroup([imported], "live-entry-limit"),
    ).toBeUndefined();
    expect(
      getAppendFailureGroup([live, imported], "live-entry-limit"),
    ).toBeUndefined();
    expect(getAppendFailureGroup([], "live-entry-limit")).toBeUndefined();
    expect(getAppendFailureGroup([entry], "live-entry-limit")).toBeUndefined();
    expect(getAppendFailureGroup([live], "storage-failure")).toBeUndefined();
  });

  it("requires an explicit structured failure instead of matching error text", () => {
    expect(
      isLiveAppendRejection({
        kind: "live-entry-limit",
        message: "Live entry limit reached",
      }),
    ).toBe(true);
    for (const value of [
      null,
      undefined,
      "Live entry limit reached",
      new Error("Live entry limit reached"),
      Object.assign(new Error("storage failed"), { kind: "live-entry-limit" }),
      { kind: "storage-failure", message: "Live entry limit reached" },
      { kind: "live-entry-limit", message: "" },
      { kind: "live-entry-limit" },
    ])
      expect(isLiveAppendRejection(value)).toBe(false);
  });

  it("does not turn synthetic transport provenance into persisted diagnostic context", () => {
    const input = { ...entry, tenant: "orders" };
    const [transport] = [...renderBatches([input], "live")];
    const [prepared] = prepareAppendBatch(transport!);
    expect(prepared!._ingestionKind).toBe("live");
    expect(prepared!.mdc).toMatchObject({ tenant: "orders" });
    expect(prepared!.mdc).not.toHaveProperty("_ingestionKind");
    expect(input).not.toHaveProperty("_ingestionKind");
  });

  it.each(["live", "import"] as const)(
    "overwrites untrusted provenance with %s without mutating producer entries",
    (kind) => {
      const input = {
        ...entry,
        _ingestionKind:
          kind === "live" ? ("import" as const) : ("live" as const),
      };
      const [batch] = [...renderBatches([input], kind)];
      expect(batch![0]).toEqual({ ...input, _ingestionKind: kind });
      expect(batch![0]).not.toBe(input);
      expect(input._ingestionKind).not.toBe(kind);
    },
  );

  it("splits coalesced live/import/live queue blocks into homogeneous IPC batches", async () => {
    const queue = new WindowAppendQueue<LogEntry>();
    const admitted = [
      [...renderBatches([entry, entry], "live")][0]!,
      [...renderBatches([entry, entry], "import")][0]!,
      [...renderBatches([entry], "live")][0]!,
    ];
    const receipts = admitted.map((batch) => queue.enqueue(batch));
    const delivered: LogEntry[][] = [];
    await queue.flush(
      (blocks) => {
        for (const block of blocks.batches(MAX_BATCH_ENTRIES)) {
          delivered.push(...renderBatches(block));
        }
        return Promise.resolve();
      },
      () => 0,
    );
    await Promise.all(receipts);
    expect(
      delivered.map((batch) => batch.map((item) => item._ingestionKind)),
    ).toEqual([["live", "live"], ["import", "import"], ["live"]]);
    expect(queue.length).toBe(0);
    queue.dispose();
  });

  it("preserves count and byte bounds along with provenance boundaries", () => {
    const batches = [
      ...renderBatches(
        Array.from({ length: MAX_BATCH_ENTRIES + 1 }, () => entry),
        "import",
      ),
    ];
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(MAX_BATCH_ENTRIES + 1);
    expect(batches.every((batch) => batch.length <= MAX_BATCH_ENTRIES)).toBe(
      true,
    );
    const large = { ...entry, message: "x".repeat(300 * 1024) };
    const byteBatches = [...renderBatches([large, large], "import")];
    expect(byteBatches.map((batch) => batch.length)).toEqual([1, 1]);
    expect(
      byteBatches.every((batch) => batch[0]!._ingestionKind === "import"),
    ).toBe(true);
  });
});
