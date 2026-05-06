/**
 * In-App dialog bridge.
 *
 * Provides a Promise-based `showConfirm()` / `showAlert()` that can be called
 * from anywhere in the renderer (services, hooks, utilities) without needing
 * a React component to pass the callback in.
 *
 * A React component (mounted once at the top of the tree) registers itself
 * as the active handler via `registerInAppDialogHandlers()`.
 *
 * NOTE: Native dialogs (`window.alert`/`window.confirm`) are intentionally
 * NOT used as a fallback – they trigger an Electron/Chromium bug that breaks
 * keyboard input in the webContents. If no handler is registered (which
 * should never happen in production after App mount), we log a warning and
 * resolve with a safe default.
 */

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: "info" | "warning" | "danger";
}

export interface AlertOptions {
  title?: string;
  type?: "info" | "warning" | "error";
}

type ConfirmHandler = (
  message: string,
  options?: ConfirmOptions,
) => Promise<boolean>;
type AlertHandler = (message: string, options?: AlertOptions) => Promise<void>;

let confirmHandler: ConfirmHandler | null = null;
let alertHandler: AlertHandler | null = null;

export function registerInAppDialogHandlers(handlers: {
  confirm?: ConfirmHandler;
  alert?: AlertHandler;
}): () => void {
  if (handlers.confirm) confirmHandler = handlers.confirm;
  if (handlers.alert) alertHandler = handlers.alert;
  return () => {
    if (handlers.confirm && confirmHandler === handlers.confirm) {
      confirmHandler = null;
    }
    if (handlers.alert && alertHandler === handlers.alert) {
      alertHandler = null;
    }
  };
}

/**
 * Promise-based confirm. Resolves to true (OK) or false (Cancel).
 * Renders an in-app modal when a handler is registered; otherwise falls
 * back to native window.confirm.
 */
export function showConfirm(
  message: string,
  options?: ConfirmOptions,
): Promise<boolean> {
  if (confirmHandler) {
    try {
      return confirmHandler(message, options);
    } catch (e) {
      console.warn("[inAppDialog] confirm handler threw:", e);
    }
  }
  console.warn(
    "[inAppDialog] showConfirm called before handler was registered; resolving false:",
    message,
  );
  return Promise.resolve(false);
}

/**
 * Promise-based alert. Resolves once the user dismisses the dialog.
 * Renders an in-app modal when a handler is registered.
 */
export function showAlert(
  message: string,
  options?: AlertOptions,
): Promise<void> {
  if (alertHandler) {
    try {
      return alertHandler(message, options);
    } catch (e) {
      console.warn("[inAppDialog] alert handler threw:", e);
    }
  }
  console.warn(
    "[inAppDialog] showAlert called before handler was registered:",
    message,
  );
  return Promise.resolve();
}
