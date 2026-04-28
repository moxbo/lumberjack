/**
 * useAlertRunner – evaluates alert rules against incoming log entries
 * and dispatches notifications (native + toast).
 *
 * Lifecycle:
 *   1. Caller passes rules (from useAlertRules) + a callback to register
 *      a "new entries" listener.
 *   2. On each batch, the evaluator returns fired events; we send them
 *      to the OS notification API and to the in-app toaster.
 */
import { useEffect, useMemo, useRef } from "preact/hooks";
import {
  AlertEvaluator,
  type AlertEntryLike,
  type AlertEvent,
  type AlertRule,
} from "../services/AlertEvaluator";
import logger from "../utils/logger";

interface NotificationApi {
  notificationShow?: (args: {
    title: string;
    body: string;
    severity?: "info" | "warning" | "critical";
  }) => Promise<{ ok: boolean; error?: string }>;
}

interface UseAlertRunnerOptions {
  rules: AlertRule[];
  /** Called for each fired event (for in-app toast). */
  onEvent?: (ev: AlertEvent) => void;
  /** Disable native OS notifications (still calls onEvent). */
  disableNativeNotifications?: boolean;
}

export function useAlertRunner(options: UseAlertRunnerOptions) {
  const evaluator = useMemo(() => new AlertEvaluator([]), []);
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;
  const disableNativeRef = useRef(!!options.disableNativeNotifications);
  disableNativeRef.current = !!options.disableNativeNotifications;

  // Keep evaluator rules in sync.
  useEffect(() => {
    evaluator.setRules(options.rules);
  }, [evaluator, options.rules]);

  /**
   * Evaluate a batch of entries (call this from the renderer's append-pipeline).
   * Returns fired events for callers that want to react further.
   */
  const evaluate = useMemo(
    () =>
      function evaluateBatch(entries: AlertEntryLike[]): AlertEvent[] {
        if (!entries.length) return [];
        const events = evaluator.evaluate(entries);
        if (events.length === 0) return events;
        // Dispatch
        for (const ev of events) {
          try {
            onEventRef.current?.(ev);
          } catch (e) {
            logger.warn("[useAlertRunner] onEvent failed:", e);
          }
          if (!disableNativeRef.current) {
            const w = window as unknown as { api?: NotificationApi };
            const api = w.api;
            if (api?.notificationShow) {
              const lvl = ev.triggeringLevel || "?";
              const lg = ev.triggeringLogger || "";
              const body = `[${lvl}] ${lg}\n${ev.triggeringMessage}`.slice(
                0,
                300,
              );
              void api
                .notificationShow({
                  title: "🚨 " + ev.ruleName,
                  body,
                  severity: ev.severity,
                })
                .catch((e: unknown) => {
                  logger.warn("[useAlertRunner] notification failed:", e);
                });
            }
          }
        }
        return events;
      },
    [evaluator],
  );

  return { evaluate };
}
