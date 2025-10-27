// Lightweight lazy-instantiation helper for singleton exports
// Returns a Proxy that will instantiate the real object on first property access.
export function lazyInstance<T>(factory: () => T): T {
  let real: T | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy({} as any, {
    get(_target, prop) {
      real = real || factory();
      // @ts-expect-error dynamic proxy
      const v = (real as any)[prop];
      return typeof v === 'function' ? v.bind(real) : v;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(_target, prop: any, value: unknown) {
      real = real || factory();
      // @ts-expect-error dynamic proxy
      (real as any)[prop] = value;
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
