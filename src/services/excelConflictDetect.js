// src/services/excelConflictDetect.js
//
// Field-level conflict detection for an Excel ↔ Survey Marker sync (PLAN.md Amendment #6:
// "conflict = the SAME field changed on BOTH sides before syncing — show a choice, never
// guess"). This is the pure, decision-free core: given three per-field fingerprint sets it
// reports which fields each side changed and which truly conflict. How the choice is shown
// to the user (the choose-a-side UI) is a separate, deliberate product decision and is NOT
// in this module.
//
// Inputs are the `fieldFingerprints` shape produced by rowFingerprint.computeRowFingerprints
// ({ changedBy, changedDate, item, entity, notes, answers: { [id]: fp } }):
//   - baseline: the values at the last successful sync (the marker's stored excelSync)
//   - appNow:   the marker's current values in the app
//   - excelIn:  the values arriving from the Excel row this sync
//
// A field counts as conflicting only when BOTH sides moved it away from the baseline AND
// they disagree with each other. If only one side changed it, that side wins with no review.
// If both sides changed DIFFERENT fields, that is a clean merge, not a conflict.

import { diffRowFields } from './rowFingerprint.js';

export const CONFLICT_CLASS = Object.freeze({
  NONE: 'none',          // nothing changed since baseline
  APP_ONLY: 'app-only',  // only the app changed → keep app
  EXCEL_ONLY: 'excel-only', // only Excel changed → take Excel
  MERGE: 'merge',        // both changed, but different fields → safe to merge
  CONFLICT: 'conflict'   // same field changed on both sides, disagreeing → needs your choice
});

/**
 * @param {{baseline?:object, appNow?:object, excelIn?:object}} args  per-field fingerprint sets
 * @returns {{conflictFields:string[], appChangedFields:string[], excelChangedFields:string[]}}
 *   Field keys use rowFingerprint's convention; answer fields are `answer:<checklistItemId>`.
 */
export const detectFieldConflicts = ({ baseline = {}, appNow = {}, excelIn = {} } = {}) => {
  const appChanged = new Set(diffRowFields(baseline, appNow));
  const excelChanged = new Set(diffRowFields(baseline, excelIn));
  const disagree = new Set(diffRowFields(appNow, excelIn));

  const conflictFields = [...appChanged]
    .filter((f) => excelChanged.has(f) && disagree.has(f))
    .sort();

  return {
    conflictFields,
    appChangedFields: [...appChanged].sort(),
    excelChangedFields: [...excelChanged].sort()
  };
};

/** Convenience boolean: does this row need a "needs your choice" review? */
export const hasRowConflict = (args) => detectFieldConflicts(args).conflictFields.length > 0;

/**
 * Classify the row into one of CONFLICT_CLASS so the import flow can decide: apply Excel,
 * keep app, merge, or surface for review. Pure and decision-free — it only describes the
 * situation; it does not choose a winner for the CONFLICT case.
 */
export const classifyRowConflict = (args) => {
  const { conflictFields, appChangedFields, excelChangedFields } = detectFieldConflicts(args);
  if (conflictFields.length > 0) return CONFLICT_CLASS.CONFLICT;
  const appChanged = appChangedFields.length > 0;
  const excelChanged = excelChangedFields.length > 0;
  if (appChanged && excelChanged) return CONFLICT_CLASS.MERGE; // disjoint fields
  if (appChanged) return CONFLICT_CLASS.APP_ONLY;
  if (excelChanged) return CONFLICT_CLASS.EXCEL_ONLY;
  return CONFLICT_CLASS.NONE;
};
