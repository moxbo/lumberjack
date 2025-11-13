/**
 * IPC Timeout Utilities
 * Prevents hanging IPC calls by adding timeout wrappers
 */

/**
 * Wrap an IPC invoke call with timeout
 */
export async function ipcInvokeWithTimeout<T>(
  channel: string,
  data: unknown,
  timeoutMs: number = 30000,
): Promise<T> {
  const win = typeof window !== "undefined" ? window : null;
  const electronAPI = (win as Record<string, unknown> | null)?.electronAPI as
    | Record<string, unknown>
    | undefined;
  if (!electronAPI || typeof electronAPI.invoke !== "function") {
    throw new Error("Electron API not available");
  }

  const invoke = electronAPI.invoke as (...args: unknown[]) => Promise<T>;
  return Promise.race([
    invoke(channel, data),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC timeout: ${channel}`)), timeoutMs),
    ),
  ]);
}

/**
 * Wrap any promise with timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = "Operation timeout",
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs),
    ),
  ]);
}
