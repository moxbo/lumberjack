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

function isUnfocusable(el: Element | null): boolean {
  if (!el) return true;
  if (!(el instanceof HTMLElement)) return true;
  if (el === document.body) return true;
  if (!el.isConnected) return true;
  // Disabled form controls cannot reliably hold focus; refocusing them is a no-op
  // and leaves Chromium's internal focus state in a broken limbo.
  return (el as HTMLElement & { disabled?: boolean }).disabled === true;
}

function focusCycle(target: HTMLElement): void {
  try {
    target.blur();
  } catch {
    /* ignore */
  }
  requestAnimationFrame(() => {
    try {
      target.focus();
    } catch {
      /* ignore */
    }
  });
}

function restoreFocus(): void {
  // First pass: immediately after the dialog closes (microtask boundary).
  // Second pass: after React has had a chance to flush state updates that
  // may have disabled the originally-focused element (e.g. the "Clear logs"
  // button becoming disabled after the entries list is emptied). Without
  // the second pass, refocusing a now-disabled element silently fails and
  // Chromium's webContents gets stuck in a state where <input> elements
  // don't accept keystrokes until the OS window loses and regains focus.
  const run = (): void => {
    try {
      const active = document.activeElement;
      const target = isUnfocusable(active)
        ? document.body
        : (active as HTMLElement);
      focusCycle(target);
    } catch {
      // Ignore focus errors
    }
  };
  setTimeout(run, 0);
  setTimeout(run, 50);
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
