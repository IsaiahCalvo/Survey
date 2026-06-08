// src/services/importFieldWhitelist.js
//
// Stage 0 attribute-only import boundary. Excel is an asynchronous attribute
// mirror: an import may edit answers / name / note / entity and may PROPOSE a
// new (unplaced) row, but it can NEVER place a marker, move one, or otherwise
// write geometry. Geometry = `pageNumber` + `bounds`; those are owned solely by
// the app/PDF. These helpers enforce that boundary at the marker-write points in
// the import paths so a malformed or hostile workbook can't inject or alter
// placement, and a future edit can't silently regress the invariant.

// The only marker fields an Excel import is allowed to author/update.
export const IMPORTABLE_MARKER_FIELDS = Object.freeze([
  'name',
  'entityId',
  'entityName',
  'entityColor',
  'note',
  'checklistResponses',
  'excelRowIndex',
  'changedBy',
  'changedDate',
]);

// Geometry / placement fields an import must never write.
export const GEOMETRY_FIELDS = Object.freeze(['pageNumber', 'bounds']);

/**
 * Force a marker to be unplaced (no geometry). Used when an import CREATES a new
 * proposed marker — it always lands in the Survey panel as an unplaced item with
 * the orange locate button, never pre-placed on a page.
 *
 * @param {object} marker  the constructed new marker
 * @returns {object}  the same marker with geometry forced null
 */
export function forceUnplacedImportedMarker(marker) {
  return { ...marker, pageNumber: null, bounds: null };
}

/**
 * Preserve an existing marker's geometry across an import update, no matter what
 * the import wrote. `updated` is the import's candidate marker; `original` is the
 * marker as it existed before the import. Placement always comes from `original`.
 *
 * @param {object} updated   the import's candidate (attributes may have changed)
 * @param {object} original  the pre-import marker (source of truth for geometry)
 * @returns {object}  `updated` with original geometry restored
 */
export function freezeGeometryFromOriginal(updated, original) {
  const safe = { ...updated };
  for (const field of GEOMETRY_FIELDS) {
    safe[field] = original ? original[field] ?? null : null;
  }
  return safe;
}

/**
 * Return only the importable (attribute) fields from a candidate patch — drops
 * geometry and any non-whitelisted key. Useful for asserting/normalising an
 * inbound attribute patch.
 *
 * @param {object} candidate
 * @returns {object}  a patch containing only importable fields present in candidate
 */
export function pickImportableFields(candidate) {
  const out = {};
  if (!candidate || typeof candidate !== 'object') return out;
  for (const field of IMPORTABLE_MARKER_FIELDS) {
    if (field in candidate) out[field] = candidate[field];
  }
  return out;
}
