/**
 * Hook that owns the in-app ConfirmDialog state and registers a Promise-based
 * `showConfirm` handler with the global dialog bridge.
 *
 * Mount this once at the root of the React tree and render the returned
 * `<ConfirmDialog … />` props somewhere in the layout.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  type ConfirmOptions,
  registerInAppDialogHandlers,
} from "../utils/inAppDialog";

interface ConfirmState {
  open: boolean;
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: "info" | "warning" | "danger";
}

const CLOSED: ConfirmState = { open: false, message: "" };

export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>(CLOSED);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback(
    (message: string, options?: ConfirmOptions): Promise<boolean> => {
      // If a previous prompt is still pending (shouldn't normally happen),
      // resolve it as cancelled before opening a new one.
      if (resolverRef.current) {
        try {
          resolverRef.current(false);
        } catch {
          /* ignore */
        }
        resolverRef.current = null;
      }
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve;
        setState({
          open: true,
          message,
          title: options?.title,
          confirmLabel: options?.confirmLabel,
          cancelLabel: options?.cancelLabel,
          type: options?.type ?? "warning",
        });
      });
    },
    [],
  );

  const settle = useCallback((value: boolean) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setState(CLOSED);
    if (r) {
      try {
        r(value);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const onConfirm = useCallback(() => settle(true), [settle]);
  const onCancel = useCallback(() => settle(false), [settle]);

  // Register globally so non-React modules can invoke showConfirm().
  useEffect(() => {
    return registerInAppDialogHandlers({ confirm: ask });
  }, [ask]);

  return { state, onConfirm, onCancel, ask };
}
