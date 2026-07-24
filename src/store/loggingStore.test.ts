import { describe, expect, it } from "vitest";
import { computeMdcFromRaw } from "./loggingStore";

describe("computeMdcFromRaw", () => {
  it("excludes message truncation metadata from diagnostic context", () => {
    const mdc = computeMdcFromRaw({
      message: "truncated preview",
      _fullMessage: "complete large message",
      _truncated: true,
      _messageSize: 123_456,
      requestId: "request-1",
    });

    expect(mdc).toEqual({ requestId: "request-1" });
  });
});
