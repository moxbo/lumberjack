/**
 * Conservative decoded-heap estimate, not a JS engine heap measurement or wire
 * size. Strings cost two bytes per UTF-16 code unit plus overhead, NOT their
 * UTF-8/JSON/network encoding length. Objects, properties and backing buffers
 * also contribute; use a separate wire-size calculation for transport limits.
 *
 * Object identities (including cycles) count once per call; strings count per
 * reference, and objects shared across calls count independently in each call.
 * Traversal is iterative without JSON serialization. Pass an admission budget
 * to stop early: Infinity means oversized or unmeasurable, never zero bytes.
 * Accessors/unsupported objects fail closed without invoking data getters.
 */
export function estimatePayloadBytes(
  value: unknown,
  maxBytes = Number.MAX_SAFE_INTEGER,
): number {
  let bytes = 0;
  const seen = new WeakSet<object>();

  function* children(object: object): Generator<unknown> {
    if (object instanceof Map) {
      for (const [key, item] of object) {
        bytes += 32;
        yield key;
        yield item;
      }
    } else if (object instanceof Set) {
      for (const item of object) {
        bytes += 16;
        yield item;
      }
    } else if (ArrayBuffer.isView(object)) {
      yield object.buffer;
      return;
    } else if (
      object instanceof ArrayBuffer ||
      (typeof SharedArrayBuffer !== "undefined" &&
        object instanceof SharedArrayBuffer)
    ) {
      bytes += object.byteLength;
    } else if (object instanceof Date) {
      bytes += 8;
    } else if (object instanceof RegExp) {
      yield object.source;
    } else if (typeof Blob !== "undefined" && object instanceof Blob) {
      bytes += object.size;
    } else if (Array.isArray(object)) {
      bytes += object.length * 8;
    } else if (
      Object.getPrototypeOf(object) !== Object.prototype &&
      Object.getPrototypeOf(object) !== null
    ) {
      bytes = Infinity;
      return;
    }
    for (const key in object) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor) continue;
      bytes += 24 + key.length * 2;
      if (!("value" in descriptor)) {
        bytes = Infinity;
        return;
      }
      yield descriptor.value;
    }
  }

  const stack: Iterator<unknown>[] = [[value][Symbol.iterator]()];
  try {
    while (stack.length > 0 && bytes <= maxBytes) {
      const next = stack[stack.length - 1]!.next();
      if (next.done) {
        stack.pop();
        continue;
      }
      const item = next.value;
      if (typeof item === "string") bytes += 24 + item.length * 2;
      else if (typeof item === "bigint") {
        // Avoid allocating a potentially giant decimal string to size a bigint.
        return Infinity;
      } else if (typeof item === "function" || typeof item === "symbol") {
        return Infinity;
      } else if (item === null || typeof item !== "object") bytes += 8;
      else if (!seen.has(item)) {
        seen.add(item);
        bytes += 64;
        stack.push(children(item));
      }
    }
  } catch {
    return Infinity;
  }
  return bytes <= maxBytes ? bytes : Infinity;
}
