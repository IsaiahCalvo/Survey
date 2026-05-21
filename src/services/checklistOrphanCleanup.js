/* checklistOrphanCleanup.js
 *
 * Pure helpers for cleaning up orphan checklist_responses keys when a
 * checklist item is hard-deleted from a template.
 *
 * Surfaced during KAL-43 UAT (see Linear KAL-44). The template editor used to
 * hard-delete checklist items without touching existing survey markers, which
 * left orphan keys in each marker's `checklist_responses` JSON. The data was
 * preserved but unreachable from the UI.
 *
 * These helpers are pure (no React, no Supabase) so they can be exercised
 * directly from tests, and so the caller (TemplatesEditor / hubSaveTemplates)
 * decides when / how to persist the cleaned rows.
 */

/**
 * Walk a template tree and collect every checklist item id that the template
 * currently knows about. Used as the "live id set" — anything keyed under a
 * marker's checklist_responses that is NOT in this set is an orphan.
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
 * Count how many survey markers reference the given checklist item id.
 * Used to power the confirmation modal copy.
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
