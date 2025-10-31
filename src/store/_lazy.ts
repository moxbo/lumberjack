// Lightweight lazy-instantiation helper for singleton exports
// Returns a Proxy that will instantiate the real object on first property access.
export function lazyInstance<T extends object>(factory: () => T): T {
  let real: T | null = null;
  return new Proxy({} as T, {
    get(_target, prop): unknown {
      real = real || factory();
      // @ts-expect-error dynamic proxy
      const v = (real as Record<string, unknown>)[prop];
      return typeof v === 'function' ? v.bind(real) : v;
    },
    set(_target, prop, value: unknown) {
      real = real || factory();
      // @ts-expect-error dynamic proxy
      (real as Record<string, unknown>)[prop] = value;
      return true;
    },
    has(_target, prop) {
      real = real || factory();
      return prop in (real as object);
    },
    ownKeys() {
      real = real || factory();
      return Reflect.ownKeys(real as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      real = real || factory();
      return Object.getOwnPropertyDescriptor(real as object, prop);
    },
  }) as unknown as T;
}
