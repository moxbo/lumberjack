/**
 * IPC Timeout Utilities
 * Prevents hanging IPC calls by adding timeout wrappers
 */

/**
 * Wrap an IPC invoke call with timeout
 */
export async function ipcInvokeWithTimeout<T>(
  channel: string,
  data: any,
  timeoutMs: number = 30000,
): Promise<T> {
  if (typeof window === "undefined" || !(window as any).electronAPI?.invoke) {
    throw new Error("Electron API not available");
  }

  return Promise.race([
    (window as any).electronAPI.invoke(channel, data) as Promise<T>,
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
