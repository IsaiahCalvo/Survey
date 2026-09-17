import assert from 'node:assert/strict';

/**
 * Resolve a CSS custom property to the px number the browser would compute.
 *
 * Reads a plain literal or a calc() built from literals, other custom
 * properties and `+ - * /` — which is all the phone size tokens use. A test
 * that resolves the token computes the same arithmetic the stylesheet does, so
 * a size assertion cannot go stale by repeating a number the sheet moved on
 * from. Anything else in the value fails loudly rather than guessing.
 */
export const pxToken = (source, name, seen = new Set()) => {
  assert.ok(!seen.has(name), `token ${name} refers to itself`);
  seen.add(name);
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(source);
  assert.notEqual(match, null, `missing token ${name}`);
  let value = match[1].trim();
  for (const ref of value.matchAll(/var\((--[\w-]+)\)/g)) {
    value = value.replace(ref[0], String(pxToken(source, ref[1], new Set(seen))));
  }
  const expression = value.replace(/\bcalc\b/g, '').replace(/px\b/g, '');
  assert.match(expression, /^[\d\s().*+/-]+$/, `token ${name} is not arithmetic: ${value}`);
  // eslint-disable-next-line no-new-func -- arithmetic only, guarded above.
  const resolved = Function(`"use strict"; return (${expression});`)();
  assert.ok(Number.isFinite(resolved), `token ${name} did not resolve`);
  return +resolved.toFixed(6);
};
