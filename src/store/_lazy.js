// Lightweight lazy-instantiation helper for singleton exports
// Returns a Proxy that will instantiate the real object on first property access.
export function lazyInstance(factory) {
  let real = null;
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === '__isProxy') return true;
        real = real || factory();
        const v = real[prop];
        return typeof v === 'function' ? v.bind(real) : v;
      },
      set(_target, prop, value) {
        real = real || factory();
        real[prop] = value;
        return true;
      },
      has(_target, prop) {
        real = real || factory();
        return prop in real;
      },
      ownKeys(_target) {
        real = real || factory();
        return Reflect.ownKeys(real);
      },
      getOwnPropertyDescriptor(_target, prop) {
        real = real || factory();
        return Object.getOwnPropertyDescriptor(real, prop);
      },
    }
  );
}
