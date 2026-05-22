/* checklistOrphanCleanup.js
 *
 * Pure helpers for the checklist-item delete + archive flow.
 *
 * Background: KAL-43 surfaced an orphan-key bug when checklist items were
 * hard-deleted from a template after survey markers already had responses for
 * them. The early fix (branch `fix/checklist-item-delete-orphan-cleanup`,
 * KAL-44 first pass) stripped orphan keys on save, but that path permanently
 * removes historical responses — not the desired product behavior.
 *
 * KAL-44 final behavior:
 *  - If a checklist item has never been used by any survey marker, deleting it
 *    can hard-delete the item (no confirm) — pure cleanup.
 *  - If a checklist item is referenced by existing survey markers, deleting it
 *    archives the item: it stays in the template structure with an `archived`
 *    flag and a snapshot of its last-known label so old responses remain
 *    inspectable in the marker UI under an "Archived" section.
 *
 * These helpers are pure (no React, no Supabase) so they can be exercised
 * directly from tests, and so the caller (TemplatesEditor / hubSaveTemplates /
 * marker UI) decides when / how to persist the cleaned rows or render the
 * archived section.
 */

/**
 * Walk a template tree and collect every checklist item id that the template
 * currently knows about (whether active or archived). Used as the "live id
 * set" — anything keyed under a marker's checklist_responses that is NOT in
 * this set is a true orphan (item was permanently hard-deleted, never used).
 *
 * For the archive flow, archived items are still part of the live id set —
 * they remain in the template structure so old responses survive reload.
 *
 * Accepts the post-normalisation template shape used by App.jsx and the
 * Supabase config blob (modules -> categories -> checklist).
 *
 * @param {object} template
 * @returns {Set<string>}
 */
export function collectLiveChecklistIds(template) {
  const ids = new Set();
  if (!template || typeof template !== 'object') return ids;
  const modules = Array.isArray(template.modules)
    ? template.modules
    : (Array.isArray(template.spaces) ? template.spaces : []);
  for (const m of modules) {
    if (!m || !Array.isArray(m.categories)) continue;
    for (const c of m.categories) {
      const items = Array.isArray(c?.checklist)
        ? c.checklist
        : (Array.isArray(c?.items) ? c.items : []);
      for (const it of items) {
        if (it && typeof it.id === 'string' && it.id) ids.add(it.id);
      }
    }
  }
  return ids;
}

/**
 * Strip orphan keys from a single survey marker's checklist_responses object.
 *
 * Used only on hard-delete of an unused item (not in archive flow). Archived
 * items are still in `liveIds`, so their response keys are preserved.
 *
 * @param {object} responses  the marker's checklist_responses JSON
 * @param {Set<string>} liveIds  ids currently present in the template
 * @returns {{ cleaned: object, removedKeys: string[] }}
 */
export function stripOrphanResponseKeys(responses, liveIds) {
  if (!responses || typeof responses !== 'object') {
    return { cleaned: {}, removedKeys: [] };
  }
  const cleaned = {};
  const removedKeys = [];
  for (const key of Object.keys(responses)) {
    if (liveIds.has(key)) {
      cleaned[key] = responses[key];
    } else {
      removedKeys.push(key);
    }
  }
  return { cleaned, removedKeys };
}

/**
 * Count how many survey markers reference the given checklist item id with a
 * non-empty response. Used to power the archive confirmation modal copy.
 *
 * A response counts as "used" if the key exists in checklist_responses, even
 * if the inner `selection` is empty — the user may have a note attached.
 *
 * Accepts the App.jsx-shaped surveyMarkers map: { [annotationId]: { checklistResponses } }
 * or a flat array of marker rows from Supabase: [{ checklist_responses }].
 *
 * @param {object|Array} markers
 * @param {string} itemId
 * @returns {number}
 */
export function countMarkersReferencingItem(markers, itemId) {
  if (!itemId) return 0;
  const list = Array.isArray(markers)
    ? markers
    : (markers && typeof markers === 'object' ? Object.values(markers) : []);
  let n = 0;
  for (const m of list) {
    if (!m) continue;
    const resp = m.checklistResponses || m.checklist_responses;
    if (resp && typeof resp === 'object' && Object.prototype.hasOwnProperty.call(resp, itemId)) {
      n += 1;
    }
  }
  return n;
}

/**
 * Plan an orphan-cleanup pass across a list of survey marker rows. Pure — does
 * not write to Supabase. Returns the rows that need updating along with their
 * new checklist_responses payloads.
 *
 * @param {Array<object>} markerRows  Supabase rows shaped like survey_markers
 * @param {Set<string>} liveIds  ids currently present in the template
 * @returns {Array<{ id: string|number, annotation_id: string, checklist_responses: object, removedKeys: string[] }>}
 */
export function planOrphanCleanup(markerRows, liveIds) {
  if (!Array.isArray(markerRows) || !(liveIds instanceof Set)) return [];
  const plan = [];
  for (const row of markerRows) {
    if (!row) continue;
    const { cleaned, removedKeys } = stripOrphanResponseKeys(row.checklist_responses, liveIds);
    if (removedKeys.length > 0) {
      plan.push({
        id: row.id,
        annotation_id: row.annotation_id,
        checklist_responses: cleaned,
        removedKeys,
      });
    }
  }
  return plan;
}

/* ============================================================================
 * Archive flow (KAL-44 final)
 * ============================================================================ */

/**
 * Mark a checklist item as archived. Pure — returns a new item object.
 *
 * Sets `archived: true`, stores the last-known label in `lastKnownLabel` so
 * the marker UI can still show a sensible row label after later edits, and
 * stamps `archivedAt` with the current ISO timestamp (or the provided one
 * for deterministic tests).
 *
 * If the item is already archived, returns the original — caller can use
 * referential equality to short-circuit downstream updates.
 *
 * @param {object} item            existing checklist item (with `id`, `text`)
 * @param {object} [opts]
 * @param {string} [opts.archivedAt]  override timestamp for tests
 * @param {string} [opts.label]       override last-known label (defaults to item.text)
 * @returns {object}
 */
export function archiveChecklistItem(item, opts = {}) {
  if (!item || typeof item !== 'object') return item;
  if (item.archived === true) return item;
  const label = typeof opts.label === 'string'
    ? opts.label
    : (item.lastKnownLabel || item.text || item.name || '');
  const archivedAt = typeof opts.archivedAt === 'string'
    ? opts.archivedAt
    : new Date().toISOString();
  return {
    ...item,
    archived: true,
    archivedAt,
    lastKnownLabel: label,
  };
}

/**
 * Predicate — true if the item is an active (non-archived) checklist item.
 * Treats missing / undefined `archived` as active (back-compat with templates
 * created before this flag existed).
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isActiveChecklistItem(item) {
  if (!item || typeof item !== 'object') return false;
  return item.archived !== true;
}

/**
 * Predicate — true if the item is archived.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isArchivedChecklistItem(item) {
  if (!item || typeof item !== 'object') return false;
  return item.archived === true;
}

/**
 * Resolve the display label for an archived item. Uses `lastKnownLabel` if
 * present (the snapshot taken at archive time), falls back to `text` /
 * `name`, then to the literal string "Archived item". Never returns empty.
 *
 * @param {object} item
 * @returns {string}
 */
export function archivedItemLabel(item) {
  if (!item || typeof item !== 'object') return 'Archived item';
  const candidates = [item.lastKnownLabel, item.text, item.name];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return 'Archived item';
}
