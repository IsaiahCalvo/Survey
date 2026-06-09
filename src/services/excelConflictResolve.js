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
