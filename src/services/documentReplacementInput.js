// Private worker snapshot helpers. No PDF/parser imports in the parent process.
const SOURCE_LIMIT = 16 * 1024 * 1024;
const invalid = () => { throw new Error('Invalid replacement input.'); };
const check = value => { if (!value) invalid(); };

/** Same conservative UTF-8/JSON-node charge for measuring and owning data.
 * This charge bounds retained inputs, not JS object overhead or process RSS.
 * Traversal is synchronous and bounded in bytes/depth, not real-time CPU. */
export function captureReplacementJson(value, { maxBytes = SOURCE_LIMIT, copy = true } = {}) {
  const budget = { left: maxBytes }, ancestors = new Set();
  function visit(value, depth) {
    check(depth <= 64);
    budget.left -= typeof value === 'string' ? Buffer.byteLength(value) + 2 : 8;
    check(budget.left >= 0);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { check(Number.isFinite(value)); return value; }
    check(value && typeof value === 'object' && !ancestors.has(value));
    const array = Array.isArray(value), ownKeys = Reflect.ownKeys(value);
    check(array || [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    check(!array || ownKeys.length === value.length + 1);
    ancestors.add(value); const result = copy ? (array ? [] : {}) : null;
    for (const key of ownKeys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      check(typeof key === 'string' && descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
      if (array) check(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length);
      budget.left -= Buffer.byteLength(key) + 3; check(budget.left >= 0);
      const owned = visit(descriptor.value, depth + 1);
      if (copy) Object.defineProperty(result, key, { value: owned, enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(value); return result;
  }
  const captured = visit(value, 0);
  return { value: captured, byteLength: maxBytes - budget.left };
}

export const copyReplacementJson = value => captureReplacementJson(value).value;

export function replacementDataProperty(value, key) {
  check(value && typeof value === 'object');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  check(descriptor?.enumerable && Object.hasOwn(descriptor, 'value'));
  return descriptor.value;
}

export function replacementByteView(value) {
  check(value instanceof Uint8Array);
  const proto = Object.getPrototypeOf(Uint8Array.prototype);
  const length = Object.getOwnPropertyDescriptor(proto, 'byteLength').get.call(value);
  const buffer = Object.getOwnPropertyDescriptor(proto, 'buffer').get.call(value);
  check(buffer instanceof ArrayBuffer && length > 0 && length <= 256 * 1024 * 1024);
  return { bytes: value, length, buffer };
}
