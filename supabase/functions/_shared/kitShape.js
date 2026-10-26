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

// Report kits: the blocks a survey report draws, in order. The engine knows
// these blocks only, so a kit can never ask for something the app cannot draw.
export const REPORT_BLOCK_TYPES = Object.freeze(['cover', 'totals', 'chart', 'table', 'issues']);
export const REPORT_CHART_STYLES = Object.freeze(['stacked', 'pie']);
export const REPORT_MAX_BLOCKS = 10;

/** Returns a list of problems; empty means the report kit is valid. */
export function validateReportKit(kit) {
  const errors = [];
  if (!kit || typeof kit !== 'object') return ['kit must be an object'];
  if (typeof kit.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(kit.id)) errors.push('id must be lower-case-kebab');
  if (kit.kind !== 'reportKit') errors.push('kind must be "reportKit"');
  if (typeof kit.version !== 'string' || !SEMVER.test(kit.version)) errors.push('version must be x.y.z');
  if (!Number.isInteger(kit.minEngine) || kit.minEngine < 1) errors.push('minEngine must be a positive integer');
  if (typeof kit.label !== 'string' || !kit.label.trim()) errors.push('label required');
  if (!Array.isArray(kit.blocks) || kit.blocks.length === 0 || kit.blocks.length > REPORT_MAX_BLOCKS) {
    errors.push(`blocks must hold 1 to ${REPORT_MAX_BLOCKS} blocks`);
  } else {
    kit.blocks.forEach((b, i) => {
      if (!b || !REPORT_BLOCK_TYPES.includes(b.type)) errors.push(`blocks[${i}].type unknown`);
      else if (b.type === 'chart' && b.style !== undefined && !REPORT_CHART_STYLES.includes(b.style)) errors.push(`blocks[${i}].style must be stacked or pie`);
    });
  }
  return errors;
}

export const ANSWER_TONES = Object.freeze(['good', 'bad', 'neutral']);
// One answer is a plain "Done" tick. Up to six show as buttons on a card; a
// longer list shows as a drop-down (CHOICE_BUTTONS_MAX in the app).
export const MIN_ANSWERS = 1;
export const MAX_ANSWERS = 20;
// An answer's optional "means" line: a hint on the card, read by the agents.
export const ANSWER_MEANS_MAX = 80;

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
    if (a?.means !== undefined && (typeof a.means !== 'string' || a.means.length > ANSWER_MEANS_MAX)) {
      errors.push(`answers[${i}].means must be text up to ${ANSWER_MEANS_MAX} characters`);
    }
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

// Checklist item kinds: pick-one (the answer set) or a typed answer. Every
// answer is saved as a plain string in the item's `selection`:
//   text   the text                  number  "8.5"  (unit, min, max)
//   score  "3" on 1..scale (5 or 10, issueAt)
//   count  "4", a whole number >= 0 (min, max)
//   date   "2026-10-22" (issueIfPast)
//   many   "Rust, Crack": any of its own options (an answer set), in order
export const TYPED_ANSWER_MAX = 200;
export const ITEM_KINDS = Object.freeze(['choice', 'text', 'number', 'score', 'count', 'date', 'many']);
export const ITEM_UNIT_MAX = 12;
export const SCORE_SCALES = Object.freeze([5, 10]);
// Every item field that belongs to its answer settings (see itemAnswerFields).
export const ITEM_ANSWER_KEYS = Object.freeze(['kind', 'unit', 'min', 'max', 'scale', 'issueAt', 'issueIfPast', 'options']);
// A Pick many line's starting options, until the template owner types their own.
export const DEFAULT_MANY_OPTIONS = Object.freeze([
  Object.freeze({ value: 'None', tone: 'good' }),
  Object.freeze({ value: 'Damaged', tone: 'bad' }),
  Object.freeze({ value: 'Missing', tone: 'bad' }),
]);

/** A Pick many line's options: its own answer set when usable, else the starting ones. */
export function manyOptionsOf(item) {
  const own = Array.isArray(item?.options) ? item.options.map((o) => {
    const means = typeof o?.means === 'string' ? o.means.trim() : '';
    return { value: typeof o?.value === 'string' ? o.value.trim() : '', tone: o?.tone, ...(means ? { means } : {}) };
  }) : null;
  return own && validateAnswerSet(own).length === 0 ? own : DEFAULT_MANY_OPTIONS.map((o) => ({ ...o }));
}

/** An item's kind: one of ITEM_KINDS, 'choice' (the default) when unknown. */
export function checklistItemKind(item) {
  return item?.kind && item.kind !== 'choice' && ITEM_KINDS.includes(item.kind) ? item.kind : 'choice';
}

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const whole = (v) => (Number.isInteger(v) ? v : null);

/** A score item's top score (5 unless set to 10). */
export const scoreScaleOf = (item) => (item?.scale === 10 ? 10 : 5);

/**
 * The answer settings an item keeps, cleaned, for its kind: {} for pick-one,
 * else { kind, ...settings }. The template editor saves exactly this, and the
 * version fingerprint and the agent read it.
 */
export function itemAnswerFields(item) {
  const kind = checklistItemKind(item);
  if (kind === 'choice') return {};
  const out = { kind };
  if (kind === 'number') {
    const unit = typeof item.unit === 'string' ? item.unit.trim().slice(0, ITEM_UNIT_MAX) : '';
    if (unit) out.unit = unit;
  }
  if (kind === 'number' || kind === 'count') {
    const pick = kind === 'count' ? (v) => (whole(v) !== null && v >= 0 ? v : null) : finite;
    const min = pick(item.min);
    const max = pick(item.max);
    if (min !== null) out.min = min;
    if (max !== null && (min === null || max >= min)) out.max = max;
  }
  if (kind === 'score') {
    out.scale = scoreScaleOf(item);
    const at = whole(item.issueAt);
    if (at !== null && at >= 1 && at < out.scale) out.issueAt = at;
  }
  if (kind === 'date' && item.issueIfPast === true) out.issueIfPast = true;
  if (kind === 'many') out.options = manyOptionsOf(item);
  return out;
}

const pad2 = (n) => String(n).padStart(2, '0');
const isoDay = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad2(m)}-${pad2(d)}` : null;
};

/** A date answer as "YYYY-MM-DD" from "2026-10-22", "10/22/2026" or a Date; null if none. */
export function dateAnswerOf(raw) {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const s = String(raw ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(s);
  if (m) return isoDay(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); // US month/day/year
  if (m) return isoDay(+m[3], +m[1], +m[2]);
  return null;
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

/**
 * Any non-pick-one answer as saved: '' for blank, the clean value, or null
 * when it does not fit the item (a score off the scale, a count below 0, a
 * date that is not a date). Pick-one answers are not handled here.
 */
export function itemAnswerFor(item, raw) {
  const kind = checklistItemKind(item);
  if (raw == null || String(raw).trim() === '') return '';
  if (kind === 'date') return dateAnswerOf(raw);
  if (kind === 'many') return manyAnswerOf(item, raw);
  if (kind === 'score' || kind === 'count') {
    const n = Number(String(raw).trim().replace(/,/g, ''));
    if (!Number.isInteger(n)) return null;
    if (kind === 'score') return n >= 1 && n <= scoreScaleOf(item) ? String(n) : null;
    return n >= 0 ? String(n) : null;
  }
  return typedAnswerFor(kind, raw);
}

/**
 * A Pick many answer as saved: the picked options in the item's order,
 * joined with ", " (options never hold commas). Matches ignore case and
 * accept ";" too ("rust; CRACK" -> "Rust, Crack"); null when a part is not
 * one of the options.
 */
export function manyAnswerOf(item, raw) {
  const options = manyOptionsOf(item);
  const parts = String(raw ?? '').split(/[,;]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return '';
  const picked = new Set();
  for (const p of parts) {
    const hit = options.find((o) => o.value.toLowerCase() === p);
    if (!hit) return null;
    picked.add(hit.value);
  }
  return options.filter((o) => picked.has(o.value)).map((o) => o.value).join(', ');
}

/** The options a Pick many answer holds, as a Set of their values. */
export const manyPicked = (item, raw) => new Set((manyAnswerOf(item, raw) || '').split(', ').filter(Boolean));

/** Today as "YYYY-MM-DD" in local time (a date answer's "past" is local). */
export const localToday = (now = new Date()) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

/**
 * Whether a non-pick-one answer is an issue: a number or count outside its
 * min / max, a score at or below its issue line, a date already past when
 * the item says so. Text never is.
 */
export function typedAnswerIsIssue(item, raw, today = localToday()) {
  const value = itemAnswerFor(item, raw);
  if (!value) return false;
  const f = itemAnswerFields(item);
  if (f.kind === 'number' || f.kind === 'count') {
    const n = Number(value);
    return (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max);
  }
  if (f.kind === 'score') return f.issueAt !== undefined && Number(value) <= f.issueAt;
  if (f.kind === 'date') return f.issueIfPast === true && value < today;
  if (f.kind === 'many') {
    const picked = manyPicked(item, value);
    return f.options.some((o) => o.tone === 'bad' && picked.has(o.value));
  }
  return false;
}

const range = (f) => (f.min !== undefined && f.max !== undefined ? ` from ${f.min} to ${f.max}`
  : f.min !== undefined ? ` of at least ${f.min}` : f.max !== undefined ? ` up to ${f.max}` : '');

/** One line on what an item asks for ("Score 1-5", "Number in ft, 7 to 9"); '' for pick-one and text. */
export function itemAnswerHint(item) {
  const f = itemAnswerFields(item);
  if (f.kind === 'number') return `Number${f.unit ? ` in ${f.unit}` : ''}${f.min !== undefined || f.max !== undefined ? `; fine${range(f)}` : ''}`;
  if (f.kind === 'count') return `Count${f.min !== undefined || f.max !== undefined ? `; fine${range(f)}` : ''}`;
  if (f.kind === 'score') return `Score 1-${f.scale}${f.issueAt !== undefined ? `; ${f.issueAt} or lower is an issue` : ''}`;
  if (f.kind === 'date') return f.issueIfPast ? 'Date; an issue once it has passed' : 'Date';
  if (f.kind === 'many') return `Pick any of ${f.options.map((o) => o.value).join(', ')}`;
  return '';
}

/** What the survey agent and the connector are told about a line's answer. */
export function itemAnswerSpec(item) {
  const { kind, ...rest } = itemAnswerFields(item);
  return kind ? { answer_kind: kind, ...rest } : {};
}
