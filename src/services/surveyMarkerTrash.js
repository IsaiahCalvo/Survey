// src/services/surveyMarkerTrash.js
//
// Stage 2 recovery net. A deleted Survey Marker is never destroyed — it becomes
// a TOMBSTONE: the full marker payload plus deletion metadata, held in a durable
// per-document trash store for a 30-day retention window. Restore reinstates the
// marker with its geometry intact; only after the window passes is a tombstone
// eligible for purge.
//
// This module is pure and storage-agnostic: it operates on plain
// `{ key: tombstone }` maps so it can be unit-tested without React, the Y.Doc, or
// localStorage. The durable persistence lives in surveyMarkerTrashStore.js.
//
// Why recovery must exist first: Amendment #1 (PLAN.md) requires that ALL
// deletes — app-origin today, Excel-origin later — be recoverable. The recovery
// net is built before any delete is allowed to touch a placed marker.

export const TRASH_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Build a tombstone record from a live marker.
 *
 * @param {object} marker  the marker being deleted (kept verbatim under `marker`)
 * @param {{ deletedAt: string, deletedBy?: string|null, origin?: string, reason?: string|null }} meta
 *        deletedAt is a required ISO string (callers pass the clock so this stays
 *        deterministic/testable); origin defaults to 'app'.
 * @returns {object} tombstone
 */
export function makeTombstone(marker, { deletedAt, deletedBy = null, origin = 'app', reason = null } = {}) {
  return {
    marker,
    deletedAt,
    deletedBy,
    origin,
    reason,
  };
}

/** True when a tombstone is older than the retention window. */
export function isTombstoneExpired(tombstone, { now, retentionDays = TRASH_RETENTION_DAYS } = {}) {
  if (!tombstone?.deletedAt || !now) return false;
  const deleted = Date.parse(tombstone.deletedAt);
  const ref = Date.parse(now);
  if (Number.isNaN(deleted) || Number.isNaN(ref)) return false;
  return ref - deleted > retentionDays * MS_PER_DAY;
}

/** Keys of tombstones past the retention window (eligible for purge). */
export function selectExpiredKeys(tombstones, { now, retentionDays = TRASH_RETENTION_DAYS } = {}) {
  const out = [];
  if (!tombstones || typeof tombstones !== 'object') return out;
  for (const [key, t] of Object.entries(tombstones)) {
    if (isTombstoneExpired(t, { now, retentionDays })) out.push(key);
  }
  return out;
}

/**
 * Add a tombstone to a trash map (returns a new map; input not mutated).
 */
export function addTombstone(tombstones, key, tombstone) {
  return { ...(tombstones || {}), [key]: tombstone };
}

/**
 * Remove a tombstone from a trash map (returns a new map; input not mutated).
 */
export function removeTombstone(tombstones, key) {
  if (!tombstones || !(key in tombstones)) return tombstones || {};
  const out = { ...tombstones };
  delete out[key];
  return out;
}

/**
 * Drop every expired tombstone from a trash map.
 * @returns {{ tombstones: object, purgedKeys: string[] }}
 */
export function purgeExpired(tombstones, { now, retentionDays = TRASH_RETENTION_DAYS } = {}) {
  const purgedKeys = selectExpiredKeys(tombstones, { now, retentionDays });
  if (purgedKeys.length === 0) return { tombstones: tombstones || {}, purgedKeys };
  const out = { ...tombstones };
  for (const key of purgedKeys) delete out[key];
  return { tombstones: out, purgedKeys };
}

/**
 * List the still-recoverable tombstones (not expired), newest first.
 * @returns {Array<{ key: string, tombstone: object }>}
 */
export function listActiveTrash(tombstones, { now, retentionDays = TRASH_RETENTION_DAYS } = {}) {
  if (!tombstones || typeof tombstones !== 'object') return [];
  return Object.entries(tombstones)
    .filter(([, t]) => !isTombstoneExpired(t, { now, retentionDays }))
    .map(([key, tombstone]) => ({ key, tombstone }))
    .sort((a, b) => Date.parse(b.tombstone.deletedAt || 0) - Date.parse(a.tombstone.deletedAt || 0));
}
