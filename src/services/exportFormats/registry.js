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
 *     columns: [                           // in sheet order, left to right
 *       { field: 'row_id', header: 'Row ID' },
 *       { field: 'checklist' },            // expands to one column per checklist item
 *       ...
 *     ],
 *   }
 */
import defaultSurveyKit from './kits/defaultSurvey.js';
import wirelessLockScheduleKit from './kits/wirelessLockSchedule.js';

export const EXPORT_ENGINE_VERSION = 1;

// Fields the engine knows how to fill. `checklist` expands to one column per item.
export const EXPORT_KIT_FIELDS = Object.freeze([
  'row_id', 'changed_by', 'changed_date', 'name', 'checklist', 'entity_name', 'notes',
]);

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Returns a list of problems; empty means the kit is valid. */
export function validateExportKit(kit) {
  const errors = [];
  if (!kit || typeof kit !== 'object') return ['kit must be an object'];
  if (typeof kit.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(kit.id)) errors.push('id must be lower-case-kebab');
  if (kit.kind !== 'exportKit') errors.push('kind must be "exportKit"');
  if (typeof kit.version !== 'string' || !SEMVER.test(kit.version)) errors.push('version must be x.y.z');
  if (!Number.isInteger(kit.minEngine) || kit.minEngine < 1) errors.push('minEngine must be a positive integer');
  if (!Array.isArray(kit.columns) || kit.columns.length === 0) {
    errors.push('columns must be a non-empty array');
  } else {
    const seen = new Set();
    kit.columns.forEach((col, i) => {
      if (!col || !EXPORT_KIT_FIELDS.includes(col.field)) errors.push(`columns[${i}].field unknown`);
      else if (seen.has(col.field)) errors.push(`columns[${i}].field "${col.field}" repeated`);
      else seen.add(col.field);
      if (col?.field !== 'checklist' && typeof col?.header !== 'string') errors.push(`columns[${i}].header required`);
    });
    // The export engine and two-way sync need every field once, with the
    // sync identity columns first (Row ID is hidden; import matches on it).
    EXPORT_KIT_FIELDS.forEach((f) => { if (!seen.has(f)) errors.push(`columns missing "${f}"`); });
    if (kit.columns.slice(0, 3).map((c) => c?.field).join() !== 'row_id,changed_by,changed_date') {
      errors.push('columns must start with row_id, changed_by, changed_date');
    }
  }
  return errors;
}

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
  const entry = Object.freeze({ ...kit, columns: Object.freeze(kit.columns.map((c) => Object.freeze({ ...c }))) });
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
export const BUILT_IN_EXPORT_KIT_IDS = Object.freeze([defaultSurveyKit.id, wirelessLockScheduleKit.id]);
registerExportKit(defaultSurveyKit);
registerExportKit(wirelessLockScheduleKit);
