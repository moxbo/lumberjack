/**
 * Focus-safe wrappers around native browser dialogs (alert / confirm / prompt).
 *
 * In Electron, native dialogs steal keyboard focus from the webContents.
 * After the dialog closes the DOM *looks* focused, but Chromium's internal
 * input routing is broken – no keystrokes reach any <input> until the user
 * Alt-Tabs away and back.
 *
 * These wrappers perform a blur → requestAnimationFrame → focus cycle
 * (the same pattern the "window:focus" IPC handler uses) after the native
 * dialog returns, which reliably re-establishes keyboard input.
 */

function restoreFocus(): void {
  setTimeout(() => {
    try {
      const active = document.activeElement;
      if (active && active !== document.body && active instanceof HTMLElement) {
        active.blur();
        requestAnimationFrame(() => {
          try {
            active.focus();
          } catch {
            /* ignore */
          }
        });
      } else {
        document.body.blur();
        requestAnimationFrame(() => {
          try {
            document.body.focus();
          } catch {
            /* ignore */
          }
        });
      }
    } catch {
      // Ignore focus errors
    }
  }, 0);
}

/** Drop-in replacement for `window.alert()` that restores keyboard focus afterwards. */
export function nativeAlert(message: string): void {
  window.alert(message);
  restoreFocus();
}

/** Drop-in replacement for `window.confirm()` that restores keyboard focus afterwards. */
export function nativeConfirm(message: string): boolean {
  const result = window.confirm(message);
  restoreFocus();
  return result;
}

/** Drop-in replacement for `window.prompt()` that restores keyboard focus afterwards. */
export function nativePrompt(
  message: string,
  defaultValue?: string,
): string | null {
  const result = window.prompt(message, defaultValue);
  restoreFocus();
  return result;
}

/**
 * Standalone helper – call this if you already used a native dialog
 * without the wrappers above and need to fix focus after the fact.
 */
export { restoreFocus as restoreFocusAfterNativeDialog };
