// filepath: /Users/mo/develop/my-electron-app/src/hooks/useDebounce.ts
import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/**
 * Hook that debounces a value.
 * Returns the debounced value that only updates after the specified delay.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Publishes the first changed value immediately, then coalesces rapid updates
 * to at most one publication per interval while retaining the latest value.
 */
export function useThrottledValue<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value);
  const latestValueRef = useRef(value);
  const lastPublishedAtRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    latestValueRef.current = value;
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    const now = Date.now();
    const elapsed = now - lastPublishedAtRef.current;
    if (elapsed >= interval) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      lastPublishedAtRef.current = now;
      setThrottledValue(value);
      return;
    }

    if (!timeoutRef.current) {
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        lastPublishedAtRef.current = Date.now();
        setThrottledValue(latestValueRef.current);
      }, interval - elapsed);
    }
  }, [value, interval]);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  return throttledValue;
}

/**
 * Hook that returns a debounced callback function.
 * The callback will only be executed after the specified delay since the last call.
 */
export function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay],
  ) as T;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
}

/**
 * Hook that provides both immediate and debounced values.
 * Useful for inputs where you want immediate UI feedback but debounced filtering.
 */
export function useDebouncedState<T>(
  initialValue: T,
  delay: number,
): [T, T, (value: T) => void] {
  const [immediateValue, setImmediateValue] = useState<T>(initialValue);
  const debouncedValue = useDebounce(immediateValue, delay);

  return [immediateValue, debouncedValue, setImmediateValue];
}
