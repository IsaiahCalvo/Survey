// src/services/excelConflictResolve.js
//
// Resolves a both-sides "needs your choice" conflict on a Survey Marker (PLAN.md Amendment
// #6 — one choice per item, whole row at once: "keep my version" vs "use Excel's version").
//
// "Use Excel's version" → applyExcelValuesToMarker returns a NEW marker carrying Excel's
//   substantive content (item name, entity, notes, checklist answers, and the Changed By
//   audit initials). The Changed Date stays as the marker has it.
// "Keep my version" → no field changes; the caller simply re-stamps the baseline.
//
// In BOTH cases the caller re-stamps the marker's excelSync baseline to the INCOMING Excel
// values (via excelIdentityRecord). That makes the next sync see Excel == baseline, so the
// row stops flagging: "use Excel's" then matches on both sides; "keep mine" reads as an
// app-only change (the marker still differs from the agreed Excel baseline) which is kept,
// never re-prompted. This is what lets a choice stick even while live writeback is gated off.
//
// Pure — never mutates its inputs.

/**
 * Apply the incoming Excel row values onto a marker ("use Excel's version").
 * @param {object} marker     the current Survey Marker
 * @param {{item, entity, notes, changedBy, answers}} values  the incoming Excel row values
 * @param {Array<{id,name,color}>} [entities]  the template's entity list (to resolve id/color)
 * @returns {object} a NEW marker reflecting Excel's content
 */
export const applyExcelValuesToMarker = (marker = {}, values = {}, entities = []) => {
  const matchEntity = (entities || []).find((e) => e && e.name === values.entity);

  const checklistResponses = { ...(marker.checklistResponses || {}) };
  for (const [checklistId, selection] of Object.entries(values.answers || {})) {
    checklistResponses[checklistId] = {
      ...(checklistResponses[checklistId] || {}),
      selection: selection || ''
    };
  }

  return {
    ...marker,
    name: values.item || marker.name,
    entityName: values.entity || '',
    // Resolve the entity id/color from the template when the name matches a known entity;
    // otherwise keep whatever the marker already had (Excel only carries the entity NAME).
    entityId: matchEntity ? matchEntity.id : marker.entityId,
    entityColor: matchEntity ? matchEntity.color : marker.entityColor,
    note: { ...(marker.note || {}), text: values.notes || '' },
    checklistResponses,
    changedBy: values.changedBy || marker.changedBy
  };
};

/**
 * Which Excel fields a conflict choice writes onto the marker. The choice only decides
 * the DISPUTED fields; everything else follows the normal merge rule (a field only Excel
 * changed takes Excel's value, a field only the app changed keeps the app's):
 *   - "use Excel's version" → every field Excel changed since the last sync,
 *   - "keep my version"     → the fields Excel changed that are NOT in dispute.
 * Before this, "use Excel's" also wrote Excel's stale copy over app-only edits, and
 * "keep mine" dropped Excel's undisputed edits for good (the baseline moves past them).
 *
 * @param {{choice:'excel'|'app', excelChangedFields:string[], conflictFields?:string[]}} args
 * @returns {string[]} field keys (rowFingerprint convention: item, entity, notes, changedBy,
 *   changedDate, answer:<id>)
 */
export const excelFieldsForConflictChoice = ({ choice, excelChangedFields = [], conflictFields = [] } = {}) => {
  const disputed = new Set(conflictFields || []);
  const fields = (excelChangedFields || []).filter((key) => choice === 'excel' || !disputed.has(key));
  // A disputed field is by definition one Excel changed; keep it on "use Excel's" even if
  // the changed list came in short.
  if (choice === 'excel') for (const key of disputed) if (!fields.includes(key)) fields.push(key);
  return fields;
};

/**
 * Apply only the given Excel fields onto a marker. Same value mapping as
 * applyExcelValuesToMarker; the Changed Date stays as the marker has it.
 * @returns {object} a NEW marker (the input marker when no field applies)
 */
export const applyExcelFieldsToMarker = (marker = {}, values = {}, entities = [], fieldKeys = []) => {
  const keys = new Set(fieldKeys || []);
  if (keys.size === 0) return marker;
  const next = { ...marker };
  if (keys.has('item')) next.name = values.item || marker.name;
  if (keys.has('entity')) {
    const matchEntity = (entities || []).find((e) => e && e.name === values.entity);
    next.entityName = values.entity || '';
    next.entityId = matchEntity ? matchEntity.id : marker.entityId;
    next.entityColor = matchEntity ? matchEntity.color : marker.entityColor;
  }
  if (keys.has('notes')) next.note = { ...(marker.note || {}), text: values.notes || '' };
  if (keys.has('changedBy')) next.changedBy = values.changedBy || marker.changedBy;
  const answerIds = [...keys].filter((key) => key.startsWith('answer:')).map((key) => key.slice('answer:'.length));
  if (answerIds.length > 0) {
    const checklistResponses = { ...(marker.checklistResponses || {}) };
    for (const id of answerIds) {
      // A column missing from the row (removed in Excel) is left alone, as the
      // whole-row apply does.
      if (!values.answers || !Object.prototype.hasOwnProperty.call(values.answers, id)) continue;
      checklistResponses[id] = {
        ...(checklistResponses[id] || {}),
        selection: values.answers[id] || ''
      };
    }
    next.checklistResponses = checklistResponses;
  }
  return next;
};
