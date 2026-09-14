import { describe, expect, it, vi } from "vitest";
import { useHttpPollErrors } from "../useHttpPolling";
import { onHttpPollError } from "../../utils/typedApi";
vi.mock("preact/hooks", () => ({
  useRef: <T>(value: T) => ({ current: value }),
  useEffect: (effect: () => unknown) => effect(),
}));
vi.mock("../../utils/typedApi", () => ({
  onHttpPollError: vi.fn(() => vi.fn()),
}));

describe("HTTP terminal failure state", () => {
  it("clears the stopped poll, reports the error and remembers startup-racing failures", () => {
    let current: number | null = 7;
    const setId = vi.fn(
      (next: number | null | ((value: number | null) => number | null)) => {
        current = typeof next === "function" ? next(current) : next;
      },
    );
    const status = vi.fn();
    const alert = vi.fn();
    const failedId = useHttpPollErrors(setId, status, alert);
    const receive = vi.mocked(onHttpPollError).mock.lastCall![0];
    receive({ id: 7, url: "http://example.test/log", error: "ENOSPC" });
    expect(current).toBeNull();
    expect(failedId.current).toBe(7);
    expect(status).toHaveBeenCalledWith("http://example.test/log: ENOSPC");
    expect(alert).toHaveBeenCalledWith("http://example.test/log: ENOSPC");
    current = 9;
    receive({ id: 8, url: "http://example.test/log", error: "quota" });
    expect(current).toBe(9);
    expect(failedId.current).toBe(8);
  });
});
