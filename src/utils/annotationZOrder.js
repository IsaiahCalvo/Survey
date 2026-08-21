/**
 * Persistent annotation z-order (KB-2 / P1-33).
 *
 * Stacking is array order at render time. The durable store is a keyed Y.Map,
 * so a pure permutation diffs to zero ops. Stamp `data.zOrder` (LexoRank-style
 * fractional key) on the moved object(s) so the existing per-object sync
 * emits a real payload change, then stable-sort on materialize.
 *
 * Objects without zOrder keep Y.Map insertion order via an implicit key
 * derived from that insertion index. Imported PDF markups stay unstamped
 * until the user reorders them.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const DIGIT_INDEX = new Map(DIGITS.split('').map((ch, i) => [ch, i]));
const IMPLICIT_PREFIX = 'V';

export function annotationStableId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const id = (obj.data && typeof obj.data === 'object' ? obj.data.id : undefined)
    ?? obj.id
    ?? obj.annotationId
    ?? obj.pdfAnnotationId;
  return (typeof id === 'string' && id) || (typeof id === 'number' ? String(id) : null);
}

export function readZOrder(obj) {
  const z = obj?.data && typeof obj.data === 'object' ? obj.data.zOrder : undefined;
  return typeof z === 'string' && z.length > 0 ? z : null;
}

export function implicitKeyFromIndex(index) {
  const n = Math.max(0, Number(index) || 0) + 1;
  return `${IMPLICIT_PREFIX}${n.toString(36).padStart(4, '0')}`;
}

export function effectiveZOrderKey(obj, insertionIndex) {
  return readZOrder(obj) || implicitKeyFromIndex(insertionIndex);
}

function digitAt(key, i) {
  if (i >= key.length) return 0;
  const idx = DIGIT_INDEX.get(key[i]);
  return idx == null ? 0 : idx;
}

/**
 * Strictly increasing successor. Prefers incrementing the last digit;
 * appends a mid digit when the key is all max-digits.
 */
export function keyAfter(key) {
  if (!key) return `${IMPLICIT_PREFIX}1`;
  for (let i = key.length - 1; i >= 0; i -= 1) {
    const idx = DIGIT_INDEX.get(key[i]);
    if (idx != null && idx < DIGITS.length - 1) {
      return key.slice(0, i) + DIGITS[idx + 1];
    }
  }
  return `${key}${DIGITS[Math.floor(DIGITS.length / 2)]}`;
}

/**
 * A key lexicographically before `key`. Uses a midpoint with the empty
 * prefix so we never emit an empty string.
 */
export function keyBefore(key) {
  if (!key) return 'U';
  return midpointKey('', key);
}

function midpointKey(a, b) {
  const maxLen = Math.max(a.length, b.length) + 1;
  let result = '';
  for (let i = 0; i < maxLen; i += 1) {
    const ai = i < a.length ? digitAt(a, i) : 0;
    const bi = i < b.length ? digitAt(b, i) : DIGITS.length - 1;
    if (bi - ai > 1) {
      const mid = Math.floor((ai + bi) / 2);
      return result + DIGITS[mid];
    }
    result += DIGITS[ai];
  }
  return `${result}${DIGITS[Math.floor(DIGITS.length / 2)]}`;
}

/**
 * Fractional key strictly between `before` and `after` (either may be null).
 * `before` must be < `after` when both are present.
 */
export function generateKeyBetween(before, after) {
  if (before != null && after != null && before >= after) {
    return keyAfter(before);
  }
  if (before == null && after == null) return `${IMPLICIT_PREFIX}0`;
  if (before == null) return keyBefore(after);
  if (after == null) return keyAfter(before);
  return midpointKey(before, after);
}

export function compareZOrderKeys(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function sortObjectsByZOrder(objects) {
  if (!Array.isArray(objects) || objects.length < 2) return objects;
  const decorated = objects.map((obj, index) => ({
    obj,
    index,
    key: effectiveZOrderKey(obj, index),
    id: String(annotationStableId(obj) || ''),
  }));
  decorated.sort((left, right) => {
    const byKey = compareZOrderKeys(left.key, right.key);
    if (byKey !== 0) return byKey;
    if (left.id && right.id && left.id !== right.id) {
      return left.id < right.id ? -1 : 1;
    }
    return left.index - right.index;
  });
  return decorated.map((entry) => entry.obj);
}

export function resolveAnnotationIndexById(objects, annotationId, fallbackIndex) {
  if (!Array.isArray(objects)) return -1;
  if (annotationId != null && annotationId !== '') {
    const resolved = objects.findIndex(
      (obj) => String(annotationStableId(obj)) === String(annotationId),
    );
    if (resolved >= 0) return resolved;
    return -1;
  }
  const index = Number(fallbackIndex);
  if (!Number.isInteger(index) || index < 0 || index >= objects.length) return -1;
  return index;
}

function ensureData(obj) {
  if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
    obj.data = {};
  }
  return obj.data;
}

export function stampZOrder(obj, key) {
  if (!obj || typeof obj !== 'object') return obj;
  ensureData(obj).zOrder = key;
  return obj;
}

export function clearZOrder(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    if ('zOrder' in obj.data) delete obj.data.zOrder;
  }
  return obj;
}

function originalIndexOf(obj, originalIndexById, fallbackIndex) {
  const id = annotationStableId(obj);
  if (id != null && originalIndexById && originalIndexById.has(id)) {
    return originalIndexById.get(id);
  }
  return fallbackIndex;
}

export function buildOriginalIndexById(objects) {
  const map = new Map();
  (objects || []).forEach((obj, index) => {
    const id = annotationStableId(obj);
    if (id != null && !map.has(id)) map.set(id, index);
  });
  return map;
}

/**
 * Stamp the object now at `movedIndex` with a key between its new neighbors.
 * Neighbor keys use persisted zOrder when present, otherwise the neighbor's
 * pre-move (insertion/visual) index so rematerialize compares in one keyspace.
 */
export function stampZOrderAfterMove(objects, movedIndex, originalIndexById) {
  if (!Array.isArray(objects) || movedIndex < 0 || movedIndex >= objects.length) return null;
  const beforeObj = movedIndex > 0 ? objects[movedIndex - 1] : null;
  const afterObj = movedIndex < objects.length - 1 ? objects[movedIndex + 1] : null;
  const beforeKey = beforeObj
    ? effectiveZOrderKey(beforeObj, originalIndexOf(beforeObj, originalIndexById, movedIndex - 1))
    : null;
  const afterKey = afterObj
    ? effectiveZOrderKey(afterObj, originalIndexOf(afterObj, originalIndexById, movedIndex + 1))
    : null;
  const key = generateKeyBetween(beforeKey, afterKey);
  stampZOrder(objects[movedIndex], key);
  return key;
}

/**
 * After a group permutation, stamp each selected object between its new
 * neighbors. Walks in array order so an already-stamped selected neighbor
 * is used as the next bound.
 */
export function stampZOrderForSelected(objects, selectedIds, originalIndexById) {
  if (!Array.isArray(objects) || !selectedIds?.size) return;
  objects.forEach((obj, index) => {
    const id = annotationStableId(obj);
    if (id == null || !selectedIds.has(String(id))) return;
    stampZOrderAfterMove(objects, index, originalIndexById);
  });
}

/**
 * Place a newly pasted/duplicated clone on top of the current page.
 */
export function stampZOrderOnTop(obj, siblingObjects) {
  if (!obj || typeof obj !== 'object') return obj;
  const last = Array.isArray(siblingObjects) && siblingObjects.length
    ? siblingObjects[siblingObjects.length - 1]
    : null;
  const lastKey = last
    ? effectiveZOrderKey(last, siblingObjects.length - 1)
    : null;
  stampZOrder(obj, generateKeyBetween(lastKey, null));
  return obj;
}
