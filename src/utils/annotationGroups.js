/**
 * Annotation Groups — persistent grouping of shapes + callouts on a page.
 *
 * Storage model (v1, flat — no nested groups):
 *   - Annotation objects:  obj.data.groupId = '<string>'  (or absent / falsy)
 *   - Callout objects:     callout.groupId  = '<string>'  (or absent / falsy)
 *
 * Two members on the same page sharing the same groupId belong to one group.
 * Empty / null / undefined / '' all mean "ungrouped".
 *
 * Used by the Group / Ungroup feature wired through:
 *   - Right-click menu items in hooks/useAnnotationContextMenu.jsx (Group /
 *     Ungroup), shown only with the Nightly 'group-marks' flag.
 *   - Cmd+G / Cmd+Shift+G in SVGAnnotationLayer.jsx: still short-circuited
 *     (Drawboard has no group key; Ctrl+G is Survey's Next match).
 *   - Auto-expand-on-click in useSVGInteraction.js (clicking any member of
 *     a group selects every member of that group).
 *
 * Design reference: docs/superpowers/specs/2026-04-18-group-ungroup-design.md
 */

import { deepClone } from './deepClone.js';

/**
 * Mint a fresh group id.
 */
export function generateGroupId() {
  return `grp-${crypto.randomUUID()}`;
}

/**
 * Read the groupId off an annotation object (Fabric JSON shape).
 * Returns the string id, or null if not grouped.
 */
export function getAnnotationGroupId(obj) {
  const id = obj && obj.data && obj.data.groupId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Read the groupId off a callout (top-level field).
 * Returns the string id, or null if not grouped.
 */
export function getCalloutGroupId(callout) {
  const id = callout && callout.groupId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Find every annotation index + callout id on a page that shares ANY of
 * the given group ids. Used by Ungroup so right-clicking one member
 * dissolves the entire group, not just the right-clicked shape.
 *
 * @param {{objects: Array}|null|undefined} pageAnnotations
 * @param {Array|null|undefined} pageCallouts - callouts already filtered to this page
 * @param {Set<string>|Array<string>} groupIds
 * @returns {{annotationIndices: number[], calloutIds: string[]}}
 */
export function findGroupMembers(pageAnnotations, pageCallouts, groupIds) {
  const idSet = groupIds instanceof Set ? groupIds : new Set(groupIds || []);
  const annotationIndices = [];
  const calloutIds = [];
  if (idSet.size === 0) return { annotationIndices, calloutIds };

  const objects = pageAnnotations && Array.isArray(pageAnnotations.objects) ? pageAnnotations.objects : [];
  for (let i = 0; i < objects.length; i++) {
    const gid = getAnnotationGroupId(objects[i]);
    if (gid && idSet.has(gid)) annotationIndices.push(i);
  }
  const callouts = Array.isArray(pageCallouts) ? pageCallouts : [];
  for (const c of callouts) {
    const gid = getCalloutGroupId(c);
    if (gid && idSet.has(gid) && c && typeof c.id === 'string') calloutIds.push(c.id);
  }
  return { annotationIndices, calloutIds };
}

/**
 * Return a deep-cloned annotation page JSON with `data.groupId` written on
 * each annotation index in `indices`. Pass groupId === null to clear it.
 *
 * Pure function — does NOT mutate the input. Caller pipes the result into
 * handleSaveAnnotations.
 */
export function applyAnnotationGroupId(pageAnnotations, indices, groupId) {
  if (!pageAnnotations || !Array.isArray(pageAnnotations.objects)) return pageAnnotations;
  const indexSet = indices instanceof Set ? indices : new Set(indices);
  const next = deepClone(pageAnnotations);
  for (let i = 0; i < next.objects.length; i++) {
    if (!indexSet.has(i)) continue;
    const obj = next.objects[i];
    if (!obj) continue;
    if (!obj.data || typeof obj.data !== 'object') obj.data = {};
    if (groupId == null) {
      delete obj.data.groupId;
    } else {
      obj.data.groupId = groupId;
    }
  }
  return next;
}

/**
 * A paste / duplicate / library placement of grouped marks (Nightly
 * 'group-marks'): the copies form their OWN group, never join the source's
 * (a click on an original would otherwise pick the copies too). Members
 * copied together keep one fresh group id between them; a group that comes
 * across with a single member is no group at all, so that member's id is
 * dropped. Mutates the given clones (callers pass fresh clones).
 *
 * @param {Array} marks     pasted mark objects (group id at data.groupId)
 * @param {Array} callouts  pasted callout records (group id at groupId)
 * @param {() => string} [mint]
 */
export function remapPastedGroupIds(marks, callouts, mint = generateGroupId) {
  const markList = Array.isArray(marks) ? marks : [];
  const calloutList = Array.isArray(callouts) ? callouts : [];
  const counts = new Map();
  const count = (gid) => { if (gid) counts.set(gid, (counts.get(gid) || 0) + 1); };
  markList.forEach((m) => count(getAnnotationGroupId(m)));
  calloutList.forEach((c) => count(getCalloutGroupId(c)));
  const fresh = new Map();
  const next = (gid) => {
    if (!gid || (counts.get(gid) || 0) < 2) return null;
    if (!fresh.has(gid)) fresh.set(gid, mint());
    return fresh.get(gid);
  };
  for (const m of markList) {
    const gid = getAnnotationGroupId(m);
    if (!gid) continue;
    const id = next(gid);
    m.data = { ...m.data };
    if (id) m.data.groupId = id; else delete m.data.groupId;
  }
  for (const c of calloutList) {
    const gid = getCalloutGroupId(c);
    if (!gid) continue;
    const id = next(gid);
    if (id) c.groupId = id; else delete c.groupId;
  }
}

/** Drop a lone pasted mark's group id (it was copied without its group). */
export function stripGroupId(object) {
  if (!object || typeof object !== 'object') return object;
  if (object.data && typeof object.data === 'object' && 'groupId' in object.data) {
    object.data = { ...object.data };
    delete object.data.groupId;
  }
  if ('groupId' in object) delete object.groupId;
  return object;
}
