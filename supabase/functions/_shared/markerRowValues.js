// src/services/markerRowValues.js
//
// The ONE shared builder for a Survey Marker's visible Excel-row values. Export writes these
// exact strings into the cells and fingerprints them; import recomputes the SAME strings from
// the live marker to compare against that baseline. If export and import built values even
// slightly differently, every matched row would false-flag as a "both sides changed" conflict.
// So both sides MUST go through this single module — that is the whole point of it existing.
//
// The value shape is the {changedBy, changedDate, item, entity, notes, answers} record that
// rowFingerprint.computeRowFingerprints consumes (answers keyed by checklist-item id).
//
// Pure and deterministic given its inputs. It deliberately does NOT default a missing
// changedDate to "now" — that metadata-defaulting is the caller's choice (the export path
// runs markers through ensureSurveyMarkerMetadata first, and the import path mirrors it), so
// this builder stays free of wall-clock reads and is trivially testable.

/**
 * Resolve the per-item module data block the export uses as the ENTITY fallback. Mirrors the
 * export's lookup exactly (match an item by name + itemType === categoryName, then read its
 * module-specific block). Shared so export and import resolve the fallback identically; any
 * drift here would change the `entity` value on one side only and manufacture a false conflict.
 *
 * @param {object} params
 * @param {object} [params.items]          the live items map (id → item)
 * @param {string} [params.markerName]     the marker's name (matches item.name)
 * @param {string} [params.categoryName]   resolved category name (matches item.itemType)
 * @param {string} [params.moduleDataKey]  the module's data key (e.g. from getModuleDataKey)
 * @returns {object} the module data block, or {} when there is no match
 */
export const resolveMarkerModuleData = ({
  items = {},
  markerName = '',
  categoryName = '',
  moduleDataKey = ''
} = {}) => {
  if (!moduleDataKey) return {};
  const match = Object.values(items || {}).find(
    (it) => it && it.name === markerName && it.itemType === categoryName
  );
  return (match && match[moduleDataKey]) || {};
};

/**
 * Build the visible Excel-row values for one Survey Marker. The strings produced here are the
 * literal cell contents the export writes and the import reads back.
 *
 * @param {object} params
 * @param {object} params.marker          the Survey Marker (export passes it metadata-ensured)
 * @param {Array}  [params.checklistItems] the category's checklist items ([{id, text}, ...])
 * @param {object} [params.moduleData]    the entity-fallback block from resolveMarkerModuleData
 * @returns {{changedBy:string, changedDate:string, item:string, entity:string, notes:string,
 *           answers:Object<string,string>}}
 */
export const buildMarkerRowValues = ({ marker = {}, checklistItems = [], moduleData = {} } = {}) => {
  const changedDateRaw = marker?.changedDate || '';
  // Same MM/DD/YYYY formatting the export writes into the Changed Date cell.
  const formattedDate = changedDateRaw ? new Date(changedDateRaw).toLocaleDateString('en-US') : '';

  const responses = marker?.checklistResponses || {};
  const answers = {};
  (checklistItems || []).forEach((ci) => {
    if (!ci || ci.id == null) return;
    answers[ci.id] = responses[ci.id]?.selection || '';
  });

  return {
    changedBy: marker?.changedBy || '',
    changedDate: formattedDate,
    item: marker?.name || '',
    entity: marker?.entityName || moduleData?.entityName || '',
    notes: marker?.note?.text || '',
    answers
  };
};
