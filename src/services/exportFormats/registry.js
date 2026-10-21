/**
 * exportFormats/registry.js — the list of Excel export formats ("export kits").
 *
 * An export kit is plain data (no code) that says how a survey category
 * becomes a sheet: which columns, in what order, filled from which field.
 * Kits are built once for a customer, kept here, and copied/tweaked for the
 * next customer.
 *
 * Same shape as src/survey/markerShapeProviders.js: register by id, get back
 * an unregister function; registering the same id again replaces it.
 *
 * KIT SHAPE (validated by validateExportKit)
 *   {
 *     id: 'default-survey', kind: 'exportKit', version: '1.0.0', minEngine: 1,
 *     label: 'Survey (standard)',
 *     extends: null,                       // kit id@version this was tweaked from
 *     answerSet: [{ value, tone }, ...],   // optional; see answerSets.js (checked there on use)
 *     columns: [                           // in sheet order, left to right
 *       { field: 'row_id', header: 'Row ID' },
 *       { field: 'checklist' },            // expands to one column per checklist item
 *       ...
 *     ],
 *   }
 */
import defaultSurveyKit from './kits/defaultSurvey.js';
import wirelessLockScheduleKit from './kits/wirelessLockSchedule.js';
import fireAlarmDevicesKit from './kits/fireAlarmDevices.js';
import cctvCamerasKit from './kits/cctvCameras.js';
import accessControlCommissioningKit from './kits/accessControlCommissioning.js';
import punchListKit from './kits/punchList.js';

export const EXPORT_ENGINE_VERSION = 1;

export { EXPORT_KIT_FIELDS, validateExportKit } from '../../../supabase/functions/_shared/kitShape.js';
import { validateExportKit } from '../../../supabase/functions/_shared/kitShape.js';

const kits = new Map();
const listeners = new Set();
let snapshot = null;
const notify = () => { snapshot = null; listeners.forEach((fn) => fn()); };

/** Call `fn` whenever the kit list changes; returns an unsubscribe function. */
export function subscribeExportKits(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Register a kit; returns a function that removes it again. Throws if invalid. */
export function registerExportKit(kit) {
  const errors = validateExportKit(kit);
  if (errors.length) throw new TypeError(`registerExportKit(${kit?.id}): ${errors.join('; ')}`);
  const entry = Object.freeze({
    ...kit,
    columns: Object.freeze(kit.columns.map((c) => Object.freeze({ ...c }))),
    ...(Array.isArray(kit.answerSet) ? { answerSet: Object.freeze(kit.answerSet.map((a) => Object.freeze({ value: a?.value, tone: a?.tone }))) } : {}),
  });
  kits.set(entry.id, entry);
  notify();
  return () => {
    if (kits.get(entry.id) === entry) { kits.delete(entry.id); notify(); }
  };
}

/** Kits this app build can draw (minEngine not newer than the engine). */
// Same array until the list changes, so React's useSyncExternalStore can use it.
export function listExportKits() {
  if (!snapshot) snapshot = Object.freeze([...kits.values()].filter((k) => k.minEngine <= EXPORT_ENGINE_VERSION));
  return snapshot;
}

export function getExportKit(id) {
  const kit = kits.get(id);
  return kit && kit.minEngine <= EXPORT_ENGINE_VERSION ? kit : null;
}

export const DEFAULT_EXPORT_KIT_ID = defaultSurveyKit.id;
// Kits shipped in the app; an account's kits from the database may not replace them.
const BUILT_IN_KITS = [defaultSurveyKit, wirelessLockScheduleKit, fireAlarmDevicesKit, cctvCamerasKit, accessControlCommissioningKit, punchListKit];
export const BUILT_IN_EXPORT_KIT_IDS = Object.freeze(BUILT_IN_KITS.map((k) => k.id));
BUILT_IN_KITS.forEach(registerExportKit);
