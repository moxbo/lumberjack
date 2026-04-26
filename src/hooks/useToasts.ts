/**
 * Toast notification hook (non-blocking, opposite of AlertDialog).
 *
 * Use for transient feedback: "Export erfolgreich", "Lesezeichen gesetzt", …
 * For blocking errors that need acknowledgement, keep using `useAlerts`.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export type ToastSeverity = "success" | "info" | "warning" | "error";

export interface Toast {
  id: number;
  message: string;
  severity: ToastSeverity;
  /** Auto-dismiss after N ms (0 = sticky). Default 4000. */
  durationMs: number;
}

let _idCounter = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (
      message: string,
      opts?: { severity?: ToastSeverity; durationMs?: number },
    ): number => {
      const id = _idCounter++;
      const severity = opts?.severity ?? "info";
      const durationMs = opts?.durationMs ?? 4000;
      setToasts((prev) => [...prev, { id, message, severity, durationMs }]);
      if (durationMs > 0) {
        const handle = setTimeout(() => dismiss(id), durationMs);
        timers.current.set(id, handle);
      }
      return id;
    },
    [dismiss],
  );

  // Convenience helpers
  const success = useCallback(
    (msg: string, durationMs?: number) =>
      show(msg, { severity: "success", durationMs }),
    [show],
  );
  const info = useCallback(
    (msg: string, durationMs?: number) =>
      show(msg, { severity: "info", durationMs }),
    [show],
  );
  const warning = useCallback(
    (msg: string, durationMs?: number) =>
      show(msg, { severity: "warning", durationMs }),
    [show],
  );
  const error = useCallback(
    (msg: string, durationMs?: number) =>
      show(msg, { severity: "error", durationMs: durationMs ?? 6000 }),
    [show],
  );

  // Cleanup all timers on unmount
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((h) => clearTimeout(h));
      map.clear();
    };
  }, []);

  return { toasts, show, dismiss, success, info, warning, error };
}
