import { describe, expect, it } from "vitest";
import {
  compressPayloadEntry,
  decompressPayloadEntry,
} from "../payloadCompression";
import type { PayloadRecord } from "../types";

describe("paged payload compression", () => {
  const payload = (
    stackTrace: string,
    fullMessage: string,
  ): PayloadRecord["entry"] => ({
    _id: 1,
    stackTrace,
    _fullMessage: fullMessage,
    custom: "preserved",
  });

  it("round-trips heavy fields without changing other payload data", async () => {
    const original = payload("Error\n".repeat(4_000), "message ".repeat(4_000));
    const compressed = await compressPayloadEntry(original, 1);
    const restored = await decompressPayloadEntry(compressed);

    expect(compressed._compressedHeavy).toBeDefined();
    expect(compressed.stackTrace).toBeUndefined();
    expect(compressed._fullMessage).toBeUndefined();
    expect(restored).toEqual(original);
  });

  it("leaves small payloads unmodified", async () => {
    const original = payload("short stack", "short message");
    expect(await compressPayloadEntry(original)).toBe(original);
  });

  it("uses less storage for compressible heavy fields", async () => {
    const stackTrace = "at service.method\n".repeat(20_000);
    const original = payload(stackTrace, "");
    const compressed = await compressPayloadEntry(original, 1);
    expect(compressed._compressedHeavy!.data.byteLength).toBeLessThan(
      stackTrace.length,
    );
  });
});
