/**
 * openingEditsMerge.js — keep what the user did while a cloud document was
 * still opening.
 *
 * Owner 2026-11-02: every tool works the moment the PDF shows. The saved marks
 * may still be loading then (this device's copy first, then the cloud's), and
 * each load REPLACES what the screen shows. Without this merge a mark drawn,
 * moved or deleted in that second would be painted over and lost.
 *
 * The rule: compare the screen now (`current`) with what the store last put on
 * it (`baseline`). Every mark the user added, changed or deleted since then is
 * applied on top of what the store hands over now (`next`). Marks the user did
 * not touch come from the store, so a newer copy from the cloud wins for them.
 *
 * A mark counts as changed only if its content differs, not just its object:
 * the viewer re-builds some marks without any user action (a callout is
 * re-projected when its page is measured), and those must not overwrite the
 * store's copy. For a callout only its saved payload (`data.legacyCallout`)
 * counts; its drawn children are derived from that payload.
 */
import { extractAnnotationId } from '../services/annotationDocStore.js';

function sameJson(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function markContent(object) {
  if (object?.data?.type === 'callout' && object.data.legacyCallout) {
    return object.data.legacyCallout;
  }
  return object;
}

function marksByKey(byPage) {
  const byKey = new Map();
  const keyless = new Set();
  for (const [pageKey, page] of Object.entries(byPage || {})) {
    for (const object of page?.objects || []) {
      const key = extractAnnotationId(object);
      if (key == null) keyless.add(object);
      else byKey.set(key, { pageKey, object });
    }
  }
  return { byKey, keyless };
}

/**
 * The user's edits between `baseline` and `current`, as
 * { upserts: Map<key, { pageKey, object }>, deletes: Set<key>, added: [{ pageKey, object }] }
 * (`added` holds new marks without an id), or null when there are none.
 */
export function collectOpeningMarkEdits(baseline, current) {
  if (!baseline || !current || baseline === current) return null;
  const before = marksByKey(baseline);
  const after = marksByKey(current);
  const upserts = new Map();
  const deletes = new Set();
  const added = [];
  for (const [key, now] of after.byKey) {
    const was = before.byKey.get(key);
    if (!was) {
      upserts.set(key, now);
      continue;
    }
    if (was.object === now.object && was.pageKey === now.pageKey) continue;
    if (was.pageKey === now.pageKey && sameJson(markContent(was.object), markContent(now.object))) continue;
    upserts.set(key, now);
  }
  for (const key of before.byKey.keys()) {
    if (!after.byKey.has(key)) deletes.add(key);
  }
  for (const [pageKey, page] of Object.entries(current || {})) {
    for (const object of page?.objects || []) {
      if (extractAnnotationId(object) == null && !before.keyless.has(object)) {
        added.push({ pageKey, object });
      }
    }
  }
  if (upserts.size === 0 && deletes.size === 0 && added.length === 0) return null;
  return { upserts, deletes, added };
}

/**
 * `next` (what the store hands over) with the user's opening edits on top.
 * Returns `next` itself when the user made none.
 */
export function mergeOpeningMarkEdits({ next, baseline, current }) {
  const edits = collectOpeningMarkEdits(baseline, current);
  if (!edits) return next;
  const { upserts, deletes, added } = edits;
  const merged = {};
  const placed = new Set();
  for (const [pageKey, page] of Object.entries(next || {})) {
    const objects = [];
    let changed = false;
    for (const object of page?.objects || []) {
      const key = extractAnnotationId(object);
      if (key != null && deletes.has(key)) { changed = true; continue; }
      const edit = key != null ? upserts.get(key) : null;
      if (edit) {
        changed = true;
        if (edit.pageKey === pageKey && !placed.has(key)) {
          objects.push(edit.object);
          placed.add(key);
        }
        continue;
      }
      objects.push(object);
    }
    merged[pageKey] = changed ? { ...page, objects } : page;
  }
  const append = (pageKey, object) => {
    const page = merged[pageKey];
    if (page) {
      merged[pageKey] = { ...page, objects: [...(page.objects || []), object] };
    } else {
      const { objects: _ignored, eraserMutation: _envelope, ...shell } = current?.[pageKey] || {};
      merged[pageKey] = { ...shell, objects: [object] };
    }
  };
  for (const [key, edit] of upserts) {
    if (!placed.has(key)) append(edit.pageKey, edit.object);
  }
  for (const { pageKey, object } of added) append(pageKey, object);
  return merged;
}

/**
 * Same rule for a map of records keyed by id (Survey Markers).
 */
export function mergeOpeningKeyedEdits({ next, baseline, current }) {
  if (!baseline || !current || baseline === current) return next;
  let merged = null;
  const write = (key, value) => {
    if (!merged) merged = { ...(next || {}) };
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  };
  for (const [key, value] of Object.entries(current)) {
    const was = baseline[key];
    if (was === value) continue;
    if (was !== undefined && sameJson(was, value)) continue;
    write(key, value);
  }
  for (const key of Object.keys(baseline)) {
    if (!(key in current)) write(key, undefined);
  }
  return merged || next;
}

/**
 * Same rule for a list of records with an `id` (spaces). New records go last.
 */
export function mergeOpeningListEdits({ next, baseline, current }) {
  if (!Array.isArray(baseline) || !Array.isArray(current) || baseline === current) return next;
  const before = new Map(baseline.filter((item) => item?.id != null).map((item) => [item.id, item]));
  const after = new Map(current.filter((item) => item?.id != null).map((item) => [item.id, item]));
  const upserts = new Map();
  const deletes = new Set();
  for (const [id, item] of after) {
    const was = before.get(id);
    if (was === item || (was !== undefined && sameJson(was, item))) continue;
    upserts.set(id, item);
  }
  for (const id of before.keys()) if (!after.has(id)) deletes.add(id);
  if (upserts.size === 0 && deletes.size === 0) return next;
  const result = [];
  for (const item of Array.isArray(next) ? next : []) {
    if (item?.id != null && deletes.has(item.id)) continue;
    if (item?.id != null && upserts.has(item.id)) {
      result.push(upserts.get(item.id));
      upserts.delete(item.id);
      continue;
    }
    result.push(item);
  }
  for (const item of upserts.values()) result.push(item);
  return result;
}
