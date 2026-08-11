import { describe, expect, it } from "vitest";
import { InMemoryLogRepository } from "../InMemoryLogRepository";
import { createEntrySignature } from "../types";

describe("InMemoryLogRepository", () => {
  it("stores complete payloads and tracks source/signature deduplication", async () => {
    const repository = new InMemoryLogRepository();
    const [id] = await repository.putMany([
      {
        timestamp: "2026-01-01T00:00:00Z",
        logger: "app",
        message: "started",
        source: "file.log",
        stackTrace: "details",
      },
    ]);

    expect(id).toBe(1);
    expect(await repository.getPayload(id!)).toMatchObject({
      _id: 1,
      message: "started",
      stackTrace: "details",
    });
    const signature = createEntrySignature({
      timestamp: "2026-01-01T00:00:00Z",
      logger: "app",
      message: "started",
      source: "file.log",
    });
    expect(
      await repository.findExistingSignatures([
        {
          source: "file.log",
          signature,
        },
      ]),
    ).toEqual(new Set([`file.log\0${signature}`]));
  });

  it("resets IDs and payloads when cleared", async () => {
    const repository = new InMemoryLogRepository();
    await repository.putMany([
      { timestamp: 1, message: "old", source: "file.log" },
    ]);

    await repository.clear();
    const [id] = await repository.putMany([
      { timestamp: 2, message: "new", source: "file.log" },
    ]);

    expect(id).toBe(1);
    expect((await repository.getPayloads([1])).get(1)?.message).toBe("new");
  });
});
