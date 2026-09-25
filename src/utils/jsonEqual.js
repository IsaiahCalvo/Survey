// jsonEqual(a, b) === (JSON.stringify(a) === JSON.stringify(b)), without
// building the two strings.
//
// Why (w29, open speed): the viewer's "unsaved annotations" check stringified
// the whole page map twice on every change. For a big document (Package 2:
// 3,071 imported ink marks) that was ~70 ms of main-thread work per change,
// including on open. This walks both values in stringify order and stops at
// the first difference, so a changed document answers almost at once; only
// two equal values are walked completely.
//
// Same rules as JSON.stringify: toJSON(key) is applied first (a member whose
// toJSON returns undefined is left out), boxed primitives become their
// value, own enumerable string keys in their order, object members whose
// value is undefined / a function / a symbol are left out, array holes and
// such values become null, numbers that are not finite become null.

function skipped(value) {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

// What JSON.stringify serialises for `value` found under `key`.
function resolve(value, key) {
  let out = value;
  if (out !== null && (typeof out === 'object' || typeof out === 'bigint') && typeof out.toJSON === 'function') {
    out = out.toJSON(key);
  }
  if (out instanceof Number || out instanceof String || out instanceof Boolean) out = out.valueOf();
  return out;
}

function members(object) {
  const out = [];
  for (const key of Object.keys(object)) {
    const value = resolve(object[key], key);
    if (!skipped(value)) out.push([key, value]);
  }
  return out;
}

// a and b are already resolved.
function equal(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      let left = resolve(a[index], String(index));
      let right = resolve(b[index], String(index));
      if (skipped(left)) left = null;
      if (skipped(right)) right = null;
      if (!equal(left, right)) return false;
    }
    return true;
  }
  const aMembers = members(a);
  const bMembers = members(b);
  if (aMembers.length !== bMembers.length) return false;
  for (let index = 0; index < aMembers.length; index += 1) {
    if (aMembers[index][0] !== bMembers[index][0]) return false;
    if (!equal(aMembers[index][1], bMembers[index][1])) return false;
  }
  return true;
}

export function jsonEqual(a, b) {
  return equal(resolve(a, ''), resolve(b, ''));
}
