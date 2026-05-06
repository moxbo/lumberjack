/**
 * Compatibility wrappers around dialog APIs.
 *
 * Native browser dialogs (`window.alert`/`confirm`/`prompt`) trigger a
 * well-known Electron/Chromium bug: after the dialog closes, keyboard
 * input routing inside the webContents stays broken until the OS window
 * loses and regains focus. We therefore route everything to in-app modal
 * components via `inAppDialog`.
 *
 * The exported names are kept for backwards compatibility with existing
 * callers:
 *   - `nativeAlert(msg)`     → in-app alert (non-blocking, fire-and-forget)
 *   - `nativeConfirm(msg)`   → in-app confirm (Promise<boolean>) – BREAKING:
 *                              previously synchronous boolean. Callers must
 *                              `await` it.
 */

import {
  showAlert as inAppAlert,
  showConfirm as inAppConfirm,
} from "./inAppDialog";

/** Drop-in replacement for `window.alert()` (non-blocking, in-app modal). */
export function nativeAlert(message: string): void {
  // Fire and forget – the in-app modal renders without blocking JS execution.
  void inAppAlert(message);
}

/**
 * Promise-based confirm. Renders the in-app ConfirmDialog and resolves to
 * true (OK) or false (Cancel). NOTE: callers must `await` this.
 */
export function nativeConfirm(message: string): Promise<boolean> {
  return inAppConfirm(message);
}
