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
 * Hook that debounces a value but also exposes a `flush` function that
 * immediately applies the current value (skipping the remaining delay).
 *
 * Useful for "type-to-filter with debounce" inputs where pressing Enter
 * should apply the filter right away instead of waiting for the delay.
 *
 * Returns a tuple of `[debouncedValue, flush]`.
 */
export function useDebouncedValueWithFlush<T>(
  value: T,
  delay: number,
): [T, (overrideValue?: T) => void] {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const valueRef = useRef<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    valueRef.current = value;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setDebouncedValue(value);
      timerRef.current = null;
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [value, delay]);

  const flush = useCallback((overrideValue?: T) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDebouncedValue(
      overrideValue !== undefined ? overrideValue : valueRef.current,
    );
  }, []);

  return [debouncedValue, flush];
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
