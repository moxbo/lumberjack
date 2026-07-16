/**
 * Hook that drives the HTTP-poll "next poll in Xs" countdown.
 *
 * Keeps a live countdown string in sync with the scheduled next-poll time and
 * re-arms itself on the real poll interval so the countdown keeps running even
 * when individual poll ticks do not emit events.
 */
import { useEffect, useState } from "preact/hooks";

export interface UseHttpPollCountdownOptions {
  /** Active poll id, or null when polling is stopped. */
  httpPollId: number | null;
  /** The real poll interval in ms currently in effect, or null. */
  currentPollInterval: number | null;
}

export interface UseHttpPollCountdownReturn {
  /** Human-readable countdown, e.g. "3s", or "" when inactive. */
  nextPollIn: string;
  /** Set the absolute timestamp (ms) of the next scheduled poll. */
  setNextPollDueAt: (dueAt: number | null) => void;
}

export function useHttpPollCountdown({
  httpPollId,
  currentPollInterval,
}: UseHttpPollCountdownOptions): UseHttpPollCountdownReturn {
  const [nextPollDueAt, setNextPollDueAt] = useState<number | null>(null);
  const [nextPollIn, setNextPollIn] = useState<string>("");

  useEffect(() => {
    if (!nextPollDueAt) {
      setNextPollIn("");
      return;
    }
    let t = 0 as unknown as number;
    const tick = () => {
      const ms = Math.max(0, Number(nextPollDueAt) - Date.now());
      const active = httpPollId != null && currentPollInterval != null;
      setNextPollIn(ms > 0 ? `${Math.ceil(ms / 1000)}s` : active ? "0s" : "");
    };
    tick();
    t = window.setInterval(tick, 250) as unknown as number;
    return () => clearInterval(t as unknown as number);
  }, [nextPollDueAt, httpPollId, currentPollInterval]);

  // Keep the countdown running even when individual ticks emit no events.
  useEffect(() => {
    const interval =
      currentPollInterval != null ? Math.max(500, currentPollInterval) : null;
    if (httpPollId == null || interval == null) {
      return;
    }
    // On (re-)start, set DueAt immediately.
    setNextPollDueAt(Date.now() + interval);

    // Then keep re-arming it on the real interval.
    const h = window.setInterval(() => {
      setNextPollDueAt(Date.now() + interval);
    }, interval) as unknown as number;

    return () => {
      clearInterval(h as unknown as number);
    };
  }, [httpPollId, currentPollInterval]);

  return { nextPollIn, setNextPollDueAt };
}
