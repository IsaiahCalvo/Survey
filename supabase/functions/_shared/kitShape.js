/**
 * kitShape.js — what a custom-builds kit may contain. Shared by the app
 * (src/services/exportFormats/registry.js, src/services/answerSets.js) and
 * the kits-admin edge function, so the server checks kits the same way.
 * Plain JS with no imports so both Node/Vite and Deno can load it.
 */

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

export const ANSWER_TONES = Object.freeze(['good', 'bad', 'neutral']);
// One answer is a plain "Done" tick; six is as many buttons as fit a phone card.
export const MIN_ANSWERS = 1;
export const MAX_ANSWERS = 6;

/** Returns a list of problems; empty means the set is usable. */
export function validateAnswerSet(set) {
  if (!Array.isArray(set) || set.length < MIN_ANSWERS || set.length > MAX_ANSWERS) return [`answer set needs ${MIN_ANSWERS} to ${MAX_ANSWERS} answers`];
  const errors = [];
  const seen = new Set();
  set.forEach((a, i) => {
    const v = typeof a?.value === 'string' ? a.value.trim() : '';
    // Excel list validation is a comma-separated string, so no commas or quotes.
    if (!v || v.length > 20 || /[",]/.test(v)) errors.push(`answers[${i}].value must be 1-20 characters, no commas or quotes`);
    else if (seen.has(v)) errors.push(`answers[${i}].value "${v}" repeated`);
    else seen.add(v);
    if (!ANSWER_TONES.includes(a?.tone)) errors.push(`answers[${i}].tone must be good, bad or neutral`);
  });
  return errors;
}


// Kits that ship inside the app; a published kit may never take their ids.
export const BUILT_IN_KIT_IDS = Object.freeze([
  'default-survey', 'wireless-lock-schedule', 'fire-alarm-devices', 'cctv-cameras',
  'access-control-commissioning', 'punch-list', 'door-hardware-check', 'intrusion-alarm-test',
  'network-rack-audit', 'emergency-lighting-test',
]);

/** Every problem with a kit someone wants to publish; empty means it can go. */
export function publishProblems(kit) {
  const errors = validateExportKit(kit);
  if (kit && kit.answerSet !== undefined) errors.push(...validateAnswerSet(kit.answerSet));
  if (kit && BUILT_IN_KIT_IDS.includes(kit.id)) errors.push(`${kit.id} is built into the app; pick another id`);
  return errors;
}

// Checklist item kinds: pick-one (the answer set), or a typed text / number.
export const TYPED_ANSWER_MAX = 200;

/** An item's kind: 'text', 'number', or 'choice' (the default). */
export function checklistItemKind(item) {
  return item?.kind === 'text' || item?.kind === 'number' ? item.kind : 'choice';
}

/**
 * A typed answer as saved: '' for blank, the trimmed text, or a plain number
 * ("1,200" -> "1200"). null when a number item gets no number.
 */
export function typedAnswerFor(kind, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (kind !== 'number') return s.slice(0, TYPED_ANSWER_MAX);
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && /\d/.test(s) ? String(n) : null;
}
