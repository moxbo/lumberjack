import { useCallback, useRef } from "preact/hooks";

export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T,
): T {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback(
    ((...args: Parameters<T>) => callbackRef.current(...args)) as T,
    [],
  );
}
