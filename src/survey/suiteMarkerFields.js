// Kal Voe suite fields on a Survey Marker (KAL-588, suite spec KAL-584).
//
// Every tracked device carries the same shared id in Walkthru, Plot and
// Survey, plus where it is. On a Survey Marker these are plain fields of the
// marker record, so they ride the live-editing doc (each field its own entry
// under 'survey-marker-fields') and the row copy's annotation_data:
//
//   suiteId             the shared id. A marker made in Survey uses its own
//                       id; a copy (paste, duplicate, copy to another Module)
//                       keeps the original's, so one real camera never splits
//                       into two. A marker that arrived from another app keeps
//                       the id it came with.
//   libraryEntryId      the library Category it is (KAL-585)
//   libraryTypeEntryId  the library Category Type, when there is one
//   building, wing, floor, location   where it is
//
// Excel never writes any of these: they are not Excel columns, and an import
// always keeps the marker's own values (importFieldWhitelist.js).
// Dependency-free so the Node tests run it as it is.

export const SUITE_ID_FIELD = 'suiteId';
export const SUITE_LINK_FIELDS = Object.freeze(['libraryEntryId', 'libraryTypeEntryId']);
export const SUITE_PLACE_FIELDS = Object.freeze(['building', 'wing', 'floor', 'location']);
export const SUITE_MARKER_FIELDS = Object.freeze([SUITE_ID_FIELD, ...SUITE_LINK_FIELDS, ...SUITE_PLACE_FIELDS]);

const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * The marker's shared id: the one it carries, else its own id (a marker made
 * in Survey before this field existed still has one, with no rewrite).
 * @param {object} record  the marker record
 * @param {string} [ownId] the marker's key in the surveyMarkers map, when the
 *   record does not carry its own `id` / `annotationId`
 */
export function suiteIdOf(record, ownId = null) {
  if (record && nonEmpty(record.suiteId)) return record.suiteId;
  const id = ownId ?? record?.id ?? record?.annotationId ?? null;
  return id == null || id === '' ? null : String(id);
}

/** The suite fields a record carries (only those set), with the shared id resolved. */
export function suiteFieldsOf(record, ownId = null) {
  const out = {};
  const suiteId = suiteIdOf(record, ownId);
  if (suiteId) out.suiteId = suiteId;
  for (const field of [...SUITE_LINK_FIELDS, ...SUITE_PLACE_FIELDS]) {
    if (record && nonEmpty(record[field])) out[field] = record[field];
  }
  return out;
}

/**
 * The suite fields a COPY of this marker gets: the same shared id (one real
 * device), the same library links and the same place.
 */
export function suiteFieldsForCopy(record, ownId = null) {
  return suiteFieldsOf(record, ownId);
}

/**
 * The marker's library Category: its own link, else the link of the template
 * category it sits in (templates save their links since KAL-585).
 */
export function libraryEntryIdOf(record, template = null) {
  if (record && nonEmpty(record.libraryEntryId)) return record.libraryEntryId;
  if (!record?.categoryId || !template) return null;
  const modules = template.modules || template.spaces || template.config?.modules || [];
  const ordered = [...modules].sort((a, b) => (a?.id === record.moduleId ? -1 : b?.id === record.moduleId ? 1 : 0));
  for (const mod of ordered) {
    const category = (mod?.categories || mod?.cats || []).find((c) => c?.id === record.categoryId);
    if (category && nonEmpty(category.libraryEntryId)) return category.libraryEntryId;
  }
  return null;
}

/**
 * Keep the marker's own suite fields over anything an import wrote: the
 * import's candidate comes in, the original's suite fields go back on.
 */
export function freezeSuiteFields(candidate, original) {
  const safe = { ...candidate };
  for (const field of SUITE_MARKER_FIELDS) delete safe[field];
  // Only what the original stores: a marker with no stored suiteId keeps
  // none (its own id stands in), so an import adds nothing new to the record.
  if (original) Object.assign(safe, suiteFieldsFromRowData(original));
  return safe;
}

/** A marker made by an import carries no suite field from the workbook. */
export function stripSuiteFields(candidate) {
  const safe = { ...candidate };
  for (const field of SUITE_MARKER_FIELDS) delete safe[field];
  return safe;
}

/** Copy the suite fields from the row's annotation_data onto a local marker. */
export function suiteFieldsFromRowData(annotationData) {
  const out = {};
  if (!annotationData || typeof annotationData !== 'object') return out;
  for (const field of SUITE_MARKER_FIELDS) {
    if (nonEmpty(annotationData[field])) out[field] = annotationData[field];
  }
  return out;
}
