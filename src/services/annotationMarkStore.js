// src/services/annotationMarkStore.js
//
// Per-field storage for annotation marks in the durable Y.Doc (2026-09-24).
// Design note: docs/ANNOTATION-FIELD-SYNC.md.
//
// Layout of the `marks` root map (store version 3):
//
//   marks[storageKey] = Y.Map {
//     p: <page number>,
//     o: Y.Map { ...the mark's fields... },
//   }
//
// Inside `o`, every plain-object value becomes a nested Y.Map (so two people
// changing different keys of `data` or of a callout's `data.legacyCallout.style`
// both keep their change — Yjs resolves each key last-writer-wins on its own).
// These stay ONE stored value, exactly like the field-level Undo diff treats
// them (annotationLocalHistory.js):
//   * arrays (points, path, quads, a callout's drawn `objects`, ...);
//   * ANNOTATION_ATOMIC_FIELD_PATHS (a text markup's textRange/textRangeModel);
//   * a linked field group (getAnnotationLinkedFieldGroup): a point shape's
//     geometry (points/path + position/size/transform) or a text markup's
//     range + box. The group is stored under one '#<name>' key holding
//     { 'left': .., 'data.quads': .., ... } so concurrent edits never mix half
//     of one person's shape with half of another's.
//
// Writes set only the keys that changed (the same per-key diff Undo uses),
// inside the caller's transaction. Deleting a mark deletes its whole entry, so
// a delete wins over a concurrent field edit. Reads build plain objects,
// cached per mark and invalidated from each transaction's changed types.
//
// Pure module: imports only 'yjs' and pure utils, runs in Node tests.

import * as Y from 'yjs';
import {
  ANNOTATION_ATOMIC_FIELD_PATHS,
  diffAnnotationFields,
  getAnnotationLinkedFieldGroup,
} from '../utils/annotationLocalHistory.js';
import { deepClone } from '../utils/deepClone.js';
import {
  normalizeAnnotationIdentity,
  setAnnotationStorageKey,
} from '../utils/annotationStorageIdentity.js';

// Store version 3 (2026-09-24): marks live in their own root map; the map's
// NAME is the version (nothing else is stamped, so no extra write). The v1
// whole-object `annotations` map is left untouched for the reference build
// and never read or written (owner ruling: old data may be lost).
export const MARKS_MAP = 'marks';
export const LEGACY_ANNOTATIONS_MAP = 'annotations';
export const ANNOTATION_STORE_VERSION = 3;

export const MARK_PAGE_KEY = 'p';
export const MARK_OBJECT_KEY = 'o';
const GROUP_KEY_PREFIX = '#';
const PATH_SEPARATOR = '.';

export function isYMap(value) {
  return value instanceof Y.Map;
}

function isPlainRecord(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function samePath(left, right) {
  return left.length === right.length
    && left.every((segment, index) => String(segment) === String(right[index]));
}

function isAtomicPath(path) {
  return ANNOTATION_ATOMIC_FIELD_PATHS.some((atomic) => samePath(atomic, path));
}

// Order-insensitive JSON so key order never reads as a change.
export function stableStringify(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (isYMap(value)) return stableStringify(value.toJSON());
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function valuesEqual(left, right) {
  if (left === right) return true;
  return stableStringify(left) === stableStringify(right);
}

// ---------------------------------------------------------------------------
// Linked groups
// ---------------------------------------------------------------------------

function groupSpecFor(object) {
  const group = getAnnotationLinkedFieldGroup(object);
  if (!group) return null;
  const memberKeys = group.paths.map((path) => path.join(PATH_SEPARATOR));
  return {
    key: `${GROUP_KEY_PREFIX}${group.name}`,
    paths: group.paths,
    memberKeys,
    isMember(path) {
      return group.paths.some((member) => samePath(member, path));
    },
    // A diff path at or below a member (pathOffset.x) belongs to the group.
    covers(path) {
      return group.paths.some((member) => (
        member.length <= path.length
        && member.every((segment, index) => String(segment) === String(path[index]))
      ));
    },
    topLevelMember(key) {
      return group.paths.some((member) => member.length === 1 && member[0] === key);
    },
  };
}

function readAtPath(record, path) {
  let cursor = record;
  for (const key of path) {
    if (!isPlainRecord(cursor) || !hasOwn(cursor, key) || cursor[key] === undefined) {
      return { present: false, value: undefined };
    }
    cursor = cursor[key];
  }
  return { present: true, value: cursor };
}

function readGroupValue(object, group) {
  const out = {};
  group.paths.forEach((path, index) => {
    const read = readAtPath(object, path);
    if (read.present) out[group.memberKeys[index]] = deepClone(read.value);
  });
  return out;
}

// A field whose own name starts with '#' (or '\\') is stored with a '\\'
// in front, so it can never be taken for a linked-group key.
function storeKey(key) {
  const text = String(key);
  return text.startsWith(GROUP_KEY_PREFIX) || text.startsWith('\\') ? `\\${text}` : text;
}

function fieldKey(stored) {
  return typeof stored === 'string' && stored.startsWith('\\') ? stored.slice(1) : stored;
}

function storedGroupKey(objectMap) {
  let found = null;
  objectMap.forEach((_value, key) => {
    if (found == null && typeof key === 'string' && key.startsWith(GROUP_KEY_PREFIX)) found = key;
  });
  return found;
}

// ---------------------------------------------------------------------------
// Encode (plain object -> Y structure)
// ---------------------------------------------------------------------------

function encodeValue(value, path, group) {
  if (isPlainRecord(value) && !isAtomicPath(path)) {
    const map = new Y.Map();
    fillRecordMap(map, value, path, group);
    return map;
  }
  return deepClone(value);
}

function fillRecordMap(ymap, record, prefix, group) {
  let groupPlaced = false;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === undefined) continue;
    const path = [...prefix, key];
    if (group && prefix.length === 0 && group.topLevelMember(key)) {
      // The group sits where its first top-level member was, so a mark reads
      // back with (nearly) its original key order.
      if (!groupPlaced) {
        ymap.set(group.key, readGroupValue(record, group));
        groupPlaced = true;
      }
      continue;
    }
    if (group && group.isMember(path)) continue;
    ymap.set(storeKey(key), encodeValue(value, path, group));
  }
  if (group && prefix.length === 0 && !groupPlaced) {
    ymap.set(group.key, readGroupValue(record, group));
  }
}

function buildObjectMap(object) {
  const map = new Y.Map();
  fillRecordMap(map, object, [], groupSpecFor(object));
  return map;
}

function buildMarkMap(page, object) {
  const mark = new Y.Map();
  mark.set(MARK_PAGE_KEY, Number(page));
  mark.set(MARK_OBJECT_KEY, buildObjectMap(object));
  return mark;
}

// ---------------------------------------------------------------------------
// Decode (Y structure -> plain object)
// ---------------------------------------------------------------------------

function decodeRecordMap(ymap) {
  const out = {};
  ymap.forEach((value, key) => {
    out[fieldKey(key)] = isYMap(value) ? decodeRecordMap(value) : value;
  });
  return out;
}

function setNested(out, path, value) {
  let cursor = out;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (!isPlainRecord(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[path[path.length - 1]] = value;
}

/** Plain object for a stored `o` map (groups expanded in place). */
export function decodeObjectMap(objectMap) {
  const out = {};
  const nested = [];
  objectMap.forEach((value, key) => {
    if (typeof key === 'string' && key.startsWith(GROUP_KEY_PREFIX)) {
      if (!isPlainRecord(value)) return;
      for (const memberKey of Object.keys(value)) {
        const path = memberKey.split(PATH_SEPARATOR);
        if (path.length === 1) out[memberKey] = value[memberKey];
        else nested.push([path, value[memberKey]]);
      }
      return;
    }
    out[fieldKey(key)] = isYMap(value) ? decodeRecordMap(value) : value;
  });
  for (const [path, value] of nested) setNested(out, path, value);
  return out;
}

/**
 * The { p, o } view of one stored mark map, or null for anything else.
 * Not cached — use readAnnotationEntry for reads.
 */
export function decodeAnnotationEntry(entry) {
  if (!isYMap(entry)) return null;
  const page = entry.get(MARK_PAGE_KEY);
  const objectMap = entry.get(MARK_OBJECT_KEY);
  if (page == null || !isYMap(objectMap)) return null;
  return { p: page, o: decodeObjectMap(objectMap) };
}

// ---------------------------------------------------------------------------
// Read cache — one plain object per mark, rebuilt only when that mark changed.
// ---------------------------------------------------------------------------

const readCaches = new WeakMap();

function rootKeyOf(type, root) {
  let current = type;
  while (current && current._item) {
    const parent = current._item.parent;
    if (parent === root) return current._item.parentSub;
    current = parent;
  }
  return null;
}

function cacheFor(doc) {
  let cache = readCaches.get(doc);
  if (cache) return cache;
  const root = doc.getMap(MARKS_MAP);
  cache = { root, entries: new Map() };
  // 'beforeObserverCalls' fires once per transaction, after its writes and
  // before ANY observer, so no observer or update listener can ever read a
  // stale cached mark. transaction.changed lists every type touched (nested
  // mark maps included, even ones deleted by the transaction).
  doc.on('beforeObserverCalls', (transaction) => {
    transaction.changed.forEach((keys, type) => {
      if (type === root) {
        keys.forEach((key) => { if (key != null) cache.entries.delete(key); });
        return;
      }
      const key = rootKeyOf(type, root);
      if (key != null) cache.entries.delete(key);
    });
  });
  readCaches.set(doc, cache);
  return cache;
}

// The map key is authoritative identity: promote it into data.id so it
// survives cloning and z-order changes (WeakMap storage key is cache only).
function materializeEntry(stored, key) {
  const decoded = decodeAnnotationEntry(stored);
  if (!decoded) return null;
  setAnnotationStorageKey(decoded.o, key);
  const object = normalizeAnnotationIdentity(decoded.o).object;
  setAnnotationStorageKey(object, key);
  return { p: decoded.p, o: object };
}

/**
 * Cached { p, o } for one mark: the stable stored object with its identity
 * normalized (eraser lanes and counter numbering are applied by docToByPage
 * on top). Rebuilt only when the mark changed. undefined when absent.
 * Callers must treat the returned object as immutable.
 */
export function readAnnotationEntry(doc, key) {
  const root = doc.getMap(MARKS_MAP);
  const stored = root.get(key);
  if (stored === undefined) return undefined;
  // Inside an open transaction the cache cannot know what changed yet.
  if (doc._transaction) return materializeEntry(stored, key) || undefined;
  const cache = cacheFor(doc);
  const hit = cache.entries.get(key);
  if (hit && hit.stored === stored) return hit.entry || undefined;
  const entry = materializeEntry(stored, key);
  cache.entries.set(key, { stored, entry });
  return entry || undefined;
}

/**
 * The stored { p, o } exactly as written (identity NOT normalized, not
 * cached). For compare-and-swap checks against objects the caller captured.
 */
export function readRawAnnotationEntry(doc, key) {
  const stored = doc.getMap(MARKS_MAP).get(key);
  return stored === undefined ? undefined : (decodeAnnotationEntry(stored) || undefined);
}

export function readAnnotationObject(doc, key) {
  return readAnnotationEntry(doc, key)?.o;
}

/**
 * Let the cache hand back the viewer's own object for a mark it just wrote,
 * when that object equals what the document now holds. Keeps the object the
 * screen already has (no needless re-render, no key-order churn).
 */
export function adoptCachedAnnotationObject(doc, key, object) {
  if (doc._transaction || !object || typeof object !== 'object') return false;
  const stored = doc.getMap(MARKS_MAP).get(key);
  if (stored === undefined) return false;
  const current = readAnnotationEntry(doc, key);
  if (!current) return false;
  if (current.o === object) return true;
  if (!valuesEqual(current.o, object)) return false;
  setAnnotationStorageKey(object, key);
  cacheFor(doc).entries.set(key, { stored, entry: { p: current.p, o: object } });
  return true;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Make `ymap` hold exactly `record` (a plain object at `prefix`), touching
 * only keys whose value differs. Returns the number of keys written.
 */
function syncRecordIntoYMap(ymap, record, prefix, group) {
  let writes = 0;
  const wanted = new Set();
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === undefined) continue;
    const path = [...prefix, key];
    if (group && group.isMember(path)) continue;
    const yKey = storeKey(key);
    wanted.add(yKey);
    const current = ymap.get(yKey);
    if (isPlainRecord(value) && !isAtomicPath(path)) {
      if (isYMap(current)) {
        writes += syncRecordIntoYMap(current, value, path, group);
      } else {
        ymap.set(yKey, encodeValue(value, path, group));
        writes += 1;
      }
      continue;
    }
    if (ymap.has(yKey) && !isYMap(current) && valuesEqual(current, value)) continue;
    ymap.set(yKey, deepClone(value));
    writes += 1;
  }
  for (const key of [...ymap.keys()]) {
    if (wanted.has(key)) continue;
    if (prefix.length === 0 && group && key === group.key) continue;
    ymap.delete(key);
    writes += 1;
  }
  if (group && prefix.length === 0) {
    const groupValue = readGroupValue(record, group);
    if (!ymap.has(group.key) || !valuesEqual(ymap.get(group.key), groupValue)) {
      ymap.set(group.key, groupValue);
      writes += 1;
    }
  }
  return writes;
}

function isEcho(echoVersions, path, present, value) {
  if (!echoVersions || echoVersions.length === 0) return false;
  return echoVersions.some((version) => {
    const read = readAtPath(version, path);
    return read.present === present && (!present || valuesEqual(read.value, value));
  });
}

function isGroupEcho(echoVersions, group, groupValue) {
  if (!echoVersions || echoVersions.length === 0) return false;
  return echoVersions.some((version) => (
    isPlainRecord(version) && valuesEqual(readGroupValue(version, group), groupValue)
  ));
}

/**
 * Write one leaf change (path -> next's value, or removal) into `objectMap`.
 * Missing intermediate maps are created from `next`'s sub-record.
 */
function writeLeaf(objectMap, path, next, group) {
  let cursor = objectMap;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = storeKey(path[index]);
    const child = cursor.get(segment);
    if (isYMap(child)) {
      cursor = child;
      continue;
    }
    const subPath = path.slice(0, index + 1);
    const sub = readAtPath(next, subPath);
    // Nothing to remove under a branch that is not a map here.
    if (!sub.present) return 0;
    if (cursor.has(segment) && valuesEqual(child, sub.value)) return 0;
    cursor.set(segment, encodeValue(sub.value, subPath, group));
    return 1;
  }
  const last = storeKey(path[path.length - 1]);
  const read = readAtPath(next, path);
  if (!read.present) {
    if (!cursor.has(last)) return 0;
    cursor.delete(last);
    return 1;
  }
  const current = cursor.get(last);
  if (isYMap(current)) {
    if (isPlainRecord(read.value) && !isAtomicPath(path)) {
      return syncRecordIntoYMap(current, read.value, path, group);
    }
  } else if (cursor.has(last) && valuesEqual(current, read.value)) {
    return 0;
  }
  cursor.set(last, encodeValue(read.value, path, group));
  return 1;
}

/**
 * Write `next` (a plain mark object) to storage key `key` on `page`.
 *
 * - No stored entry: the whole mark is created.
 * - Otherwise only the fields that differ between `base` and `next` are
 *   written (the Undo diff: nested-aware, arrays/atomic/linked groups whole).
 *   `base` = the object this change was made against; omit it to make the
 *   stored mark equal `next` (every differing field is written).
 * - `echoVersions`: objects the writer was recently handed from the document;
 *   a changed field whose value equals one of them is the screen repainting a
 *   collaborator's value, not an edit, and is not written back.
 * - A field whose stored value already equals `next`'s is never re-written.
 *
 * Must run inside a transaction when several marks are written together.
 * Returns { created, writes } (writes = Yjs keys set/deleted).
 */
export function writeAnnotationMark(doc, key, page, next, options = {}) {
  // One transaction, so a standalone call is one update (nested calls join
  // the caller's transaction).
  let result;
  doc.transact(() => { result = writeAnnotationMarkInTransaction(doc, key, page, next, options); });
  return result;
}

function writeAnnotationMarkInTransaction(doc, key, page, next, {
  base = undefined,
  basePage = undefined,
  echoVersions = null,
} = {}) {
  const root = doc.getMap(MARKS_MAP);
  const stored = root.get(key);
  const pageNumber = Number(page);
  const hasBaseObject = base !== undefined && base !== null;
  if (!isYMap(stored) || !isYMap(stored.get(MARK_OBJECT_KEY))) {
    root.set(key, buildMarkMap(pageNumber, next));
    return { created: stored === undefined, writes: 1 };
  }
  let writes = 0;
  const objectMap = stored.get(MARK_OBJECT_KEY);
  const group = groupSpecFor(next);
  const storedGroup = storedGroupKey(objectMap);
  const hasBase = hasBaseObject;

  const pageChanged = hasBase && basePage !== undefined
    ? Number(basePage) !== pageNumber
    : true;
  if (pageChanged && stored.get(MARK_PAGE_KEY) !== pageNumber) {
    stored.set(MARK_PAGE_KEY, pageNumber);
    writes += 1;
  }

  if ((group?.key ?? null) !== storedGroup || !hasBase) {
    // Full sync: no base to diff from, or the mark's field layout changed
    // (its type moved it into / out of a linked group).
    if ((group?.key ?? null) !== storedGroup && storedGroup) {
      objectMap.delete(storedGroup);
      writes += 1;
    }
    writes += syncRecordIntoYMap(objectMap, next, [], group);
    return { created: false, writes };
  }

  const changes = diffAnnotationFields(base, next);
  let groupTouched = false;
  const seen = new Set();
  for (const change of changes) {
    if (change.path.length === 0) {
      writes += syncRecordIntoYMap(objectMap, next, [], group);
      return { created: false, writes };
    }
    if (group && group.covers(change.path)) {
      groupTouched = true;
      continue;
    }
    const pathKey = JSON.stringify(change.path);
    if (seen.has(pathKey)) continue;
    seen.add(pathKey);
    const read = readAtPath(next, change.path);
    if (isEcho(echoVersions, change.path, read.present, read.value)) continue;
    writes += writeLeaf(objectMap, change.path, next, group);
  }
  if (group && groupTouched) {
    const groupValue = readGroupValue(next, group);
    if (
      !valuesEqual(objectMap.get(group.key), groupValue)
      && !isGroupEcho(echoVersions, group, groupValue)
    ) {
      objectMap.set(group.key, groupValue);
      writes += 1;
    }
  }
  return { created: false, writes };
}

/**
 * Set only the named fields of a stored mark (a counter's display number, an
 * eraser base's colour...). `patch` maps top-level keys to values; nested
 * plain objects are merged key by key. Returns the number of keys written.
 */
export function patchAnnotationMark(doc, key, page, patchObject) {
  const current = readAnnotationEntry(doc, key);
  if (!current) return 0;
  const next = mergePatch(current.o, patchObject);
  return writeAnnotationMark(doc, key, page ?? current.p, next, {
    base: current.o,
    basePage: current.p,
  }).writes;
}

function mergePatch(target, patchObject) {
  const out = { ...target };
  for (const [key, value] of Object.entries(patchObject || {})) {
    out[key] = isPlainRecord(value) && isPlainRecord(target?.[key])
      ? mergePatch(target[key], value)
      : value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Copying durable values between docs (sync layer projections / staging).
// A Y type can live in one doc only, so nested maps are rebuilt, and an
// existing target map is synced key by key rather than replaced.
// ---------------------------------------------------------------------------

function cloneYValue(value) {
  if (!isYMap(value)) return deepClone(value);
  const map = new Y.Map();
  value.forEach((child, key) => { map.set(key, cloneYValue(child)); });
  return map;
}

function syncYMapInto(target, source) {
  let writes = 0;
  const keys = new Set();
  source.forEach((value, key) => {
    keys.add(key);
    const current = target.get(key);
    if (isYMap(value)) {
      if (isYMap(current)) writes += syncYMapInto(current, value);
      else { target.set(key, cloneYValue(value)); writes += 1; }
      return;
    }
    if (target.has(key) && !isYMap(current) && valuesEqual(current, value)) return;
    target.set(key, deepClone(value));
    writes += 1;
  });
  for (const key of [...target.keys()]) {
    if (!keys.has(key)) { target.delete(key); writes += 1; }
  }
  return writes;
}

/** Make targetMap[key] equal sourceValue (any durable root map). */
export function copyDurableMapValue(targetMap, key, sourceValue) {
  const current = targetMap.get(key);
  if (isYMap(sourceValue)) {
    if (isYMap(current)) return syncYMapInto(current, sourceValue);
    targetMap.set(key, cloneYValue(sourceValue));
    return 1;
  }
  if (targetMap.has(key) && !isYMap(current) && valuesEqual(current, sourceValue)) return 0;
  targetMap.set(key, deepClone(sourceValue));
  return 1;
}

/** Plain JSON for any durable map value (mark maps included). */
export function durableValueToJSON(value) {
  return isYMap(value) ? value.toJSON() : value;
}

/**
 * Root-map keys a transaction touched, nested changes included (a field set
 * inside annotations[key].o reports `key` under the annotations map).
 * Returns Map<rootMap, Set<key>>; a Set containing null means "unknown, rescan".
 */
export function rootKeysChangedByTransaction(transaction, rootMaps) {
  const out = new Map();
  const roots = new Set(rootMaps);
  transaction.changed.forEach((keys, type) => {
    if (roots.has(type)) {
      if (!out.has(type)) out.set(type, new Set());
      keys.forEach((key) => out.get(type).add(key));
      return;
    }
    let current = type;
    while (current && current._item) {
      const parent = current._item.parent;
      if (roots.has(parent)) {
        if (!out.has(parent)) out.set(parent, new Set());
        out.get(parent).add(current._item.parentSub);
        return;
      }
      current = parent;
    }
  });
  return out;
}
