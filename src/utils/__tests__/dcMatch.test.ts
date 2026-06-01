/**
 * Unit tests for the shared DC/MDC matching logic (dcMatch).
 */
import { describe, it, expect } from "vitest";
import {
  matchesDcFilter,
  canonicalDcKey,
  type DcFilterEntry,
} from "../dcMatch";

const entry = (key: string, value: string, active = true): DcFilterEntry => ({
  key,
  value,
  active,
});

describe("dcMatch – matchesDcFilter", () => {
  it("returns true when there are no entries", () => {
    expect(matchesDcFilter({ TraceID: "a" }, [])).toBe(true);
  });

  it("returns true when no entry is active", () => {
    expect(
      matchesDcFilter({ TraceID: "a" }, [entry("TraceID", "x", false)]),
    ).toBe(true);
  });

  it("returns false when mdc is missing but a filter is active", () => {
    expect(matchesDcFilter(undefined, [entry("TraceID", "a")])).toBe(false);
  });

  describe("OR within the same key", () => {
    const filter = [entry("TraceID", "a"), entry("TraceID", "b")];

    it("matches the first value", () => {
      expect(matchesDcFilter({ TraceID: "a" }, filter)).toBe(true);
    });

    it("matches the second value", () => {
      expect(matchesDcFilter({ TraceID: "b" }, filter)).toBe(true);
    });

    it("does not match an unrelated value", () => {
      expect(matchesDcFilter({ TraceID: "c" }, filter)).toBe(false);
    });
  });

  describe("AND across different keys", () => {
    const filter = [entry("TraceID", "a"), entry("userId", "u1")];

    it("matches only when both keys match", () => {
      expect(matchesDcFilter({ TraceID: "a", userId: "u1" }, filter)).toBe(
        true,
      );
    });

    it("fails when one key does not match", () => {
      expect(matchesDcFilter({ TraceID: "a", userId: "u2" }, filter)).toBe(
        false,
      );
    });
  });

  describe("wildcard (empty value)", () => {
    const filter = [entry("userId", "")];

    it("matches any value when the key is present", () => {
      expect(matchesDcFilter({ userId: "anything" }, filter)).toBe(true);
    });

    it("does not match when the key is absent", () => {
      expect(matchesDcFilter({ other: "x" }, filter)).toBe(false);
    });
  });

  describe("case-insensitive matching", () => {
    it("matches regardless of value case", () => {
      expect(
        matchesDcFilter({ TraceID: "ABC" }, [entry("TraceID", "abc")]),
      ).toBe(true);
    });

    it("matches regardless of key case", () => {
      expect(
        matchesDcFilter({ traceid: "abc" }, [entry("TraceID", "abc")]),
      ).toBe(true);
    });
  });

  describe("trace key variants", () => {
    const filter = [entry("TraceID", "xyz")];

    for (const k of ["traceId", "trace_id", "trace.id", "trace-id", "trace"]) {
      it(`matches event key variant "${k}"`, () => {
        expect(matchesDcFilter({ [k]: "xyz" }, filter)).toBe(true);
      });
    }
  });

  it("coerces non-string mdc values", () => {
    expect(matchesDcFilter({ count: 42 }, [entry("count", "42")])).toBe(true);
    expect(matchesDcFilter({ flag: true }, [entry("flag", "true")])).toBe(true);
  });
});

describe("dcMatch – canonicalDcKey", () => {
  it("normalizes trace variants to TraceID", () => {
    expect(canonicalDcKey("trace_id")).toBe("TraceID");
    expect(canonicalDcKey("traceId")).toBe("TraceID");
  });

  it("keeps unknown keys unchanged (trimmed)", () => {
    expect(canonicalDcKey("  userId ")).toBe("userId");
  });

  it("returns empty string for empty input", () => {
    expect(canonicalDcKey("")).toBe("");
  });
});
