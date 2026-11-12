// The live sheet sync's merge: one round compares a spreadsheet with the
// survey's markers and the values both sides last agreed on (the baseline),
// and says what to write where. It is provider-neutral: Google Sheets and
// Microsoft 365 workbooks feed it the same grid and apply its plan.
//
// Rules (the same as the Excel sync, /mnt/project-files/excel-sync/audit.md):
//   * merge cell by cell: a cell changed on one side only takes that side;
//     different cells changed on both sides both land;
//   * only a cell changed on BOTH sides to DIFFERENT values is a conflict; it
//     holds just that row's disputed cells until someone picks "Keep mine" or
//     "Use the sheet's", and the choice touches only those cells;
//   * a hidden, signed Row ID column ties a row to its marker (Row-ID tokens
//     from _shared/matcher); a row with no valid Row ID is a new item;
//   * a row deleted in the sheet never deletes a marker: it is listed so a
//     person can put it back; a marker deleted in the app removes its row only
//     when nobody changed that row in the sheet.
//
// Pure apart from crypto (fingerprints, Row-ID signing): no network, no
// database, so node tests run it as is.
import { canonicalizeCellValue, computeRowFingerprints } from '../matcher/rowFingerprint.js';
import { detectFieldConflicts } from '../matcher/excelConflictDetect.js';
import { generateRowIdToken, parseRowIdToken, verifyRowIdSignature } from '../matcher/rowIdToken.js';
import { buildMarkerRowValues } from '../markerRowValues.js';
import { checklistItemKind, dateAnswerOf, itemAnswerFor } from '../kitShape.js';
import { noteObjectOf } from '../surveyUndoApply.js';
import { TRACKING_STATUSES, columnIsEditable, personCellName } from './layout.js';
import { isCellError } from './providers/contract.js';

const TRACKING_KEYS = ['status', 'assignee', 'due'];
const SCALAR_KEYS = ['changedBy', 'changedDate', 'item', 'entity', 'notes', ...TRACKING_KEYS];
// Changed By for a sheet edit when nobody can say who made it.
export const SHEET_EDITOR_UNKNOWN = 'Sheet';
const NUMBER_KINDS = new Set(['number', 'score', 'count']);
// New items one round brings in from the sheet. A pasted block of thousands
// of rows comes in over several rounds instead of one that runs out of time.
export const MAX_NEW_ROWS_PER_ROUND = 300;
// How far down a tab the header row is looked for (a title row typed above it).
const HEADER_SEARCH_ROWS = 10;
const TOTALS_LABEL = /^(grand\s+|sub-?\s*)?totals?\b|^(sum|count|average|avg)\s*:?$/i;

// Row IDs already checked by this server instance: the same tokens come back
// every round, and an HMAC per row was a fifth of a big sheet's round.
const VERIFIED = new Set();

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const isBlankCell = (c) => c == null || (!isCellError(c) && String(c).trim() === '');
const isBlankRow = (row) => !Array.isArray(row) || row.every(isBlankCell);

/** A cell as the text the app saves (10 -> "10", true -> "TRUE"). */
export function cellText(value) {
  if (value == null || isCellError(value)) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

export const sameCell = (a, b) => (isCellError(a) || isCellError(b)
  ? isCellError(a) && isCellError(b) && a.error === b.error
  : canonicalizeCellValue(cellText(a)) === canonicalizeCellValue(cellText(b)));

// Field fingerprints: what the baseline keeps per cell, so it never stores the
// survey's text. A fast synchronous hash (cyrb53) of the canonical value: a
// round fingerprints every field of every row twice, and SHA-256 through
// WebCrypto made a 3,000-row sheet cost over 3 s of CPU, past the edge
// function's limit. Only equality matters; 53 bits make a missed change from a
// collision about one in 10^16. Baselines saved before this ("v1:<sha256>")
// are still compared in their own format until a round rewrites them.
const FP_PREFIX = 'f2:';
function cyrb53(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
const printOf = (value) => `${FP_PREFIX}${cyrb53(canonicalizeCellValue(value))}`;

/** Per-field fingerprints of a record, in rowFingerprint's fieldFingerprints shape. */
export function fieldPrintsOf(rec) {
  const out = {};
  for (const k of SCALAR_KEYS) {
    // Tracking cells only on a layout that has them, so other links' baselines stay as small as before.
    if (rec?.[k] === undefined && TRACKING_KEYS.includes(k)) continue;
    out[k] = printOf(rec?.[k]);
  }
  out.answers = Object.fromEntries(Object.entries(rec?.answers || {}).map(([id, v]) => [String(id), printOf(v)]));
  return out;
}
const isLegacyPrint = (fp) => typeof fp === 'string' && !fp.startsWith(FP_PREFIX);

const getField = (rec, key) => (key.startsWith('answer:') ? (rec.answers || {})[key.slice(7)] : rec[key]);
const setField = (rec, key, value) => {
  if (key.startsWith('answer:')) rec.answers = { ...(rec.answers || {}), [key.slice(7)]: value };
  else rec[key] = value;
};
const getFp = (fps, key) => (key.startsWith('answer:') ? (fps?.answers || {})[key.slice(7)] : fps?.[key]) ?? null;
const setFp = (fps, key, value) => {
  if (key.startsWith('answer:')) {
    fps.answers = { ...(fps.answers || {}) };
    if (value == null) delete fps.answers[key.slice(7)];
    else fps.answers[key.slice(7)] = value;
  } else if (value == null) delete fps[key];
  else fps[key] = value;
};

const fieldsOf = (fps) => [
  ...SCALAR_KEYS.filter((k) => fps?.[k] != null),
  ...Object.keys(fps?.answers || {}).map((id) => `answer:${id}`),
];

const checklistOfScope = (scope) => scope.columns.filter((c) => c.key.startsWith('answer:')).map((c) => c.item);

// Excel keeps at most 32,767 characters in a cell and cuts the rest (Sheets
// 50,000). The app's side is compared and written cut to one limit under
// both, so a longer note matches what the sheet holds instead of reading as
// a change every round; the app keeps its full text unless the cell is edited.
// Excel also ends a cell at a NUL character (text pasted from some PDFs), so
// NULs are left out the same way, or the rest would come back cut off.
export const MAX_CELL_CHARS = 32000;

// Excel on the web saves a typed cell seconds to over 2 minutes late. A PM's
// value typed just before Survey wrote that cell can land over Survey's write
// minutes later and read as a plain sheet edit, quietly replacing the field's newer value.
// Survey's own cell writes are remembered this long; a different value
// landing on one of them is held as a conflict instead. Excel only (the
// provider's savesLate): Google saves as the person types.
export const RECENT_WRITE_MS = 300_000;
const RECENT_WRITE_MAX = 2000;
// A PM typing a new item into the first empty row under the list, unsaved,
// while Survey appends a field tech's new item there (Graph still sees the
// row as empty): the PM's late save lands on the tech's row. A changed Item
// on a row Survey appended this recently is taken as that, not a rename.
export const NEW_ROW_TAKEOVER_MS = 180_000;
function recentWritesOf(saved, nowMs) {
  const kept = Object.entries(saved || {})
    .filter(([, w]) => w && nowMs - Number(w.t) < RECENT_WRITE_MS)
    .sort((a, b) => Number(b[1].t) - Number(a[1].t))
    .slice(0, RECENT_WRITE_MAX);
  return Object.fromEntries(kept);
}
const fitCell = (v) => {
  if (typeof v !== 'string') return v;
  if (v.includes('\u0000')) v = v.replace(/\u0000/g, '');
  if (v.length <= MAX_CELL_CHARS) return v;
  const cut = v.slice(0, MAX_CELL_CHARS);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};

// A marker's tracking ({ status, assigneeId, due }), always whole; the same
// rules as the app's readTracking (src/utils/markerTracking.js).
const STATUS_VALUES = new Set(TRACKING_STATUSES.map((s) => s.value));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function trackingOf(marker) {
  const raw = marker?.tracking && typeof marker.tracking === 'object' ? marker.tracking : {};
  return {
    status: STATUS_VALUES.has(raw.status) ? raw.status : 'open',
    assigneeId: typeof raw.assigneeId === 'string' && raw.assigneeId ? raw.assigneeId : null,
    due: typeof raw.due === 'string' && DAY.test(raw.due) ? raw.due : null,
  };
}
const FORMER_MEMBER = 'Former member';

/**
 * The row values the app shows for a marker, in rowFingerprint's record shape,
 * plus its tracking cells (`layout.people` names who it is assigned to).
 */
export function appRecordOf(marker, scope, layout = null) {
  const rec = buildMarkerRowValues({ marker, checklistItems: checklistOfScope(scope), moduleData: {} });
  if (layout?.tracking) {
    const t = trackingOf(marker);
    rec.status = TRACKING_STATUSES.find((s) => s.value === t.status).label;
    const person = t.assigneeId ? (layout.people || []).find((p) => p.id === t.assigneeId) : null;
    rec.assignee = t.assigneeId ? (person ? personCellName(person) : FORMER_MEMBER) : '';
    rec.due = t.due || '';
  }
  for (const k of Object.keys(rec)) rec[k] = fitCell(rec[k]);
  if (rec.answers) rec.answers = Object.fromEntries(Object.entries(rec.answers).map(([id, v]) => [id, fitCell(v)]));
  return rec;
}

/** The value written into a cell for a field of an app record. */
export function cellValueFor(scope, key, rec) {
  const text = getField(rec, key) ?? '';
  if (key.startsWith('answer:') && text !== '') {
    const col = scope.columns.find((c) => c.key === key);
    if (col && NUMBER_KINDS.has(checklistItemKind(col.item))) {
      const n = Number(text);
      if (Number.isFinite(n)) return n;
    }
  }
  return String(text);
}

const normHeader = (h) => cellText(h).trim().toLowerCase();

// Map a sheet's header row to the layout's columns. Headers are matched by
// text, ignoring case and outer spaces; repeated headers pair up in order. A
// column the template renamed since the last round is found by the header it
// had then (`remembered`), and listed in `renamed` so its header is updated.
function mapHeader(scope, headerRow, remembered = {}) {
  const claimed = new Set();
  const colOfKey = new Map();
  const renamed = [];
  const claim = (column, want) => {
    if (!want) return false;
    for (let i = 0; i < (headerRow || []).length; i += 1) {
      if (!claimed.has(i) && normHeader(headerRow[i]) === want) {
        claimed.add(i);
        colOfKey.set(column.key, i);
        return true;
      }
    }
    return false;
  };
  for (const column of scope.columns) claim(column, normHeader(column.header));
  for (const column of scope.columns) {
    if (colOfKey.has(column.key)) continue;
    const old = normHeader(remembered[column.key]);
    if (old && old !== normHeader(column.header) && claim(column, old)) renamed.push(column);
  }
  return { colOfKey, renamed };
}

// The header row: the first of the top rows that holds the Row ID header
// (or the one it had) and one more of the layout's headers. Row 0 when none
// does, so a tab with no Row ID column is reported, not guessed at.
function findHeaderRow(scope, rows, remembered = {}) {
  const rowIdCol = scope.columns.find((c) => c.key === 'rowId');
  const idNames = new Set([normHeader(rowIdCol?.header), normHeader(remembered.rowId)].filter(Boolean));
  const names = new Set(scope.columns.flatMap((c) => [normHeader(c.header), normHeader(remembered[c.key])]).filter(Boolean));
  for (let r = 0; r < Math.min(rows.length, HEADER_SEARCH_ROWS); r += 1) {
    const cells = (rows[r] || []).map(normHeader);
    if (cells.some((c) => idNames.has(c)) && cells.filter((c) => names.has(c)).length >= 2) return r;
  }
  return 0;
}

const isChoiceColumn = (column) => Boolean(column?.key?.startsWith('answer:')) && checklistItemKind(column.item) === 'choice';
const TICKED = ['y', 'yes', 'pass', 'ok', 'done', 'true', 'complete', 'completed', 'checked'];
const CLEARED = ['n', 'no', 'fail', 'false'];

/**
 * The pick-one answer a checkbox means (Excel's Insert > Checkbox, or a
 * TRUE/FALSE a PM typed): ticked is the set's yes-like answer (Y, Yes, Pass,
 * OK, Done...), cleared its no-like one. A one-answer set ("Done") clears to
 * blank. null when the set has no such answer.
 */
export function checkboxAnswerOf(answerValues, on) {
  const values = (answerValues || []).map(String);
  for (const word of on ? TICKED : CLEARED) {
    const hit = values.find((v) => v.trim().toLowerCase() === word);
    if (hit) return hit;
  }
  if (values.length === 1) return on ? values[0] : '';
  return null;
}

// A checkbox cell's answer text, or null when the cell is not a checkbox.
function checkboxCellAnswer(layout, column, raw) {
  if (!isChoiceColumn(column)) return null;
  const on = raw === true || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true') ? true
    : raw === false || (typeof raw === 'string' && raw.trim().toLowerCase() === 'false') ? false : null;
  if (on === null) return null;
  // A set that really holds "TRUE" / "FALSE" answers takes them as typed.
  if (typeof raw === 'string' && layout.answerValues.some((v) => v.trim().toLowerCase() === raw.trim().toLowerCase())) return null;
  return checkboxAnswerOf(layout.answerValues, on);
}

// Turn one sheet cell into the app value for a field, or { error }.
function sheetValueToApp(layout, column, raw) {
  const text = cellText(raw).replace(/\r\n?/g, '\n');
  if (column.key === 'item' || column.key === 'notes') return { value: fitCell(text) };
  if (column.key === 'status') {
    const t = text.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    if (!t) return { value: 'Open', status: 'open' };
    const hit = TRACKING_STATUSES.find((s) => s.label.toLowerCase() === t || s.value.replace(/-/g, ' ') === t);
    return hit ? { value: hit.label, status: hit.value } : { error: `"${text.trim()}" is not a status (use ${TRACKING_STATUSES.map((s) => s.label).join(', ')})` };
  }
  if (column.key === 'assignee') {
    const t = text.trim().toLowerCase();
    if (!t) return { value: '', assigneeId: null };
    const people = layout.people || [];
    const hit = people.find((p) => personCellName(p).toLowerCase() === t)
      || people.find((p) => p.email && p.email.toLowerCase() === t);
    if (hit) return { value: personCellName(hit), assigneeId: hit.id };
    return { error: `"${text.trim()}" is not someone on this document, so "${column.header}" was not changed` };
  }
  if (column.key === 'due') {
    if (!text.trim()) return { value: '', due: null };
    const day = dateAnswerOf(text.trim());
    return day ? { value: day, due: day } : { error: `"${text.trim()}" is not a date for "${column.header}"` };
  }
  if (column.key === 'entity') {
    const name = text.trim();
    if (!name) return { value: '', entity: null };
    const hit = layout.entities.find((e) => e.name.trim().toLowerCase() === name.toLowerCase());
    return hit ? { value: hit.name, entity: hit } : { error: `"${name}" is not one of this survey's entities` };
  }
  if (column.key.startsWith('answer:')) {
    const kind = checklistItemKind(column.item);
    if (kind === 'choice') {
      const box = checkboxCellAnswer(layout, column, raw);
      if (box != null) return { value: box };
      const t = text.trim();
      if (!t) return { value: '' };
      const hit = layout.answerValues.find((v) => v.toLowerCase() === t.toLowerCase());
      return hit ? { value: hit } : { error: `"${t}" is not an answer for "${column.header}" (use ${layout.answerValues.join(', ')})` };
    }
    const value = itemAnswerFor(column.item, text);
    return value === null ? { error: `"${text.trim()}" does not fit "${column.header}"` } : { value };
  }
  return { error: 'read-only column' };
}

// A cell as the value it would give the app, or { error } (used for new rows).
function sheetCellToApp(layout, column, raw) {
  if (isCellError(raw)) return { error: `"${column.header}" shows ${raw.error}, so it was skipped` };
  return sheetValueToApp(layout, column, raw);
}

// Write one app-side field value onto a marker (a copy).
function applyFieldToMarker(marker, key, conv, nowIso) {
  if (key === 'status' || key === 'assignee' || key === 'due') {
    const t = trackingOf(marker);
    if (key === 'status') t.status = conv.status;
    else if (key === 'assignee') t.assigneeId = conv.assigneeId;
    else t.due = conv.due;
    // Back to nothing set: no tracking at all, as the app keeps it.
    if (t.status === 'open' && !t.assigneeId && !t.due) delete marker.tracking;
    else marker.tracking = { ...t, updatedAt: nowIso, updatedBy: null };
    return;
  }
  if (key === 'item') marker.name = conv.value;
  else if (key === 'notes') marker.note = { ...noteObjectOf(marker.note ?? marker.notes), text: conv.value };
  else if (key === 'entity') {
    if (conv.entity) {
      marker.entityId = conv.entity.id;
      marker.entityName = conv.entity.name;
      marker.entityColor = conv.entity.color;
    } else {
      delete marker.entityId;
      delete marker.entityName;
      delete marker.entityColor;
    }
  } else if (key.startsWith('answer:')) {
    const id = key.slice(7);
    const responses = { ...(marker.checklistResponses || {}) };
    const prior = { ...(responses[id] || {}) };
    if (conv.value === '') {
      delete prior.selection;
      if (Object.keys(prior).length) responses[id] = prior; else delete responses[id];
    } else {
      responses[id] = { ...prior, selection: conv.value };
    }
    marker.checklistResponses = responses;
  }
}

const displayOf = (value) => {
  const t = isCellError(value) ? value.error : cellText(value);
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
};

/**
 * Plan one sync round.
 *
 * @param {object} args
 * @param {object} args.layout   buildSyncLayout output
 * @param {{sheets: Array<{sheetId:string, title:string, rows:any[][]}>}} args.grid
 *        the spreadsheet as read; rows[0] is the header row
 * @param {Object<string, object>} args.markers   live markers by id
 * @param {Object<string, {scopeId:string, fields:object}>} [args.baseline]
 *        per-marker field fingerprints both sides last agreed on
 * @param {object} [args.state]  link state: sheetIds, conflicts, choices,
 *        removedInSheet, tombstones, columnsSeen, problems
 * @param {{keyId:string, secret:string, signingDocId:string}} args.signing
 * @param {() => string} [args.newMarkerId]
 * @param {string} [args.sheetEditor]  Changed By for items changed or added in
 *        the sheet this round (round.js sheetEditorLabel)
 * @param {Date} [args.now]
 * @returns {Promise<object>} the plan (see bottom of the function)
 */
export async function planSheetRound({
  layout,
  grid,
  markers,
  baseline = {},
  state = {},
  signing,
  newMarkerId = () => `surveyMarker-${crypto.randomUUID()}`,
  sheetEditor = SHEET_EDITOR_UNKNOWN,
  now = new Date(),
  holdErase = false,
  lateSaves = false,
  lockedTabs = [],
}) {
  const nextBaseline = { ...baseline };
  // Tabs that already had items before this round: the first fill of a new
  // tab is all appends, and a PM renaming one of those is a rename.
  const scopesWithItems = new Set(Object.values(baseline || {}).map((b) => b?.scopeId).filter(Boolean));
  // Many filled answers blanked in the sheet at once (an older copy restored
  // from version history, a column cleared by mistake): held until an editor
  // says which side is right, so field work is never wiped in one round.
  // 'allow' = clear them in the app too; 'restore' = write the app's back.
  const eraseMode = state.eraseChoice === 'sheet' ? 'allow'
    : state.eraseChoice === 'app' ? 'restore'
      : (holdErase || state.heldErase) ? 'hold' : 'count';
  let erasing = 0;
  const erasingItems = new Set();
  const erasingScopes = new Set();
  const next = {
    sheetIds: { ...(state.sheetIds || {}) },
    conflicts: { ...(state.conflicts || {}) },
    choices: { ...(state.choices || {}) },
    removedInSheet: { ...(state.removedInSheet || {}) },
    tombstones: { ...(state.tombstones || {}) },
    gone: { ...(state.gone || {}) },
    columnsSeen: { ...(state.columnsSeen || {}) },
    headers: { ...(state.headers || {}) },
    // "markerId|key" of cells that would not keep what Survey wrote (the
    // hidden part of merged cells): left alone until they hold a value.
    stuck: { ...(state.stuck || {}) },
    // "markerId|key" -> { t, was, wrote }: cells Survey wrote lately (see
    // RECENT_WRITE_MS), as fingerprints.
    recentWrites: lateSaves ? recentWritesOf(state.recentWrites, now.getTime()) : {},
    problems: [],
    missingTabs: [],
    // Tabs still there that lost their Row ID column or heading row (deleted,
    // cleared, typed over): not synced until undone or rebuilt (putBackTab).
    brokenTabs: [],
    // Synced tabs the PM protected (Review > Protect Sheet): left alone, so
    // one locked tab doesn't stop every other tab (real Excel 11-10).
    lockedTabs: [],
    heldErase: null,
  };
  const plan = {
    cellWrites: [], // { sheetId, title, row, col, value, markerId?, key? }   row/col are 0-based grid indexes
    // What must still be in the sheet when the writes go out: the Row ID next
    // to each write ({ token }) and the cell each write replaces ({ expect }).
    verify: [],     // { sheetId, title, row, col, token } | { sheetId, title, row, col, expect }
    appends: [],    // { sheetId, title, rows: any[][] }
    deletes: [],    // { sheetId, title, row, token }
    headerAdds: [], // { sheetId, title, row, col, header }
    markerWrites: {},
    summary: { toSheet: 0, toApp: 0, created: 0, appended: 0, deleted: 0, conflicts: 0 },
  };
  const nowIso = now.toISOString();
  const tokenFor = (markerId, scopeId) => generateRowIdToken({
    keyId: signing.keyId, secret: signing.secret, documentId: signing.signingDocId, scopeId, markerId,
  });
  const identify = async (token) => {
    const parsed = parseRowIdToken(token);
    if (!parsed.ok || parsed.documentId !== signing.signingDocId || parsed.keyId !== signing.keyId) return null;
    const known = `${signing.secret}\u0000${token}`;
    if (VERIFIED.has(known)) return parsed;
    if (!(await verifyRowIdSignature(parsed, signing.secret))) return null;
    if (VERIFIED.size >= 50000) VERIFIED.clear();
    VERIFIED.add(known);
    return parsed;
  };
  let newRowsLeft = MAX_NEW_ROWS_PER_ROUND;
  let newRowsWaiting = 0;

  const sheetsById = new Map((grid?.sheets || []).map((s) => [String(s.sheetId), s]));
  const locked = new Set((lockedTabs || []).map(String));
  const seenMarkers = new Set();
  const markersByScope = new Map();
  for (const [id, m] of Object.entries(markers || {})) {
    if (!m || typeof m !== 'object') continue;
    const scope = layout.scopes.find((s) => sameId(s.moduleId, m.moduleId) && sameId(s.categoryId, m.categoryId));
    if (!scope) continue;
    if (!markersByScope.has(scope.scopeId)) markersByScope.set(scope.scopeId, []);
    markersByScope.get(scope.scopeId).push(id);
  }

  for (const scope of layout.scopes) {
    const sheetId = next.sheetIds[scope.scopeId];
    const sheet = sheetId != null ? sheetsById.get(String(sheetId)) : null;
    if (!sheet) {
      next.missingTabs.push(scope.scopeId);
      continue;
    }
    // Nothing read or written: its items, baseline and remembered headers
    // stay as they were, and every change waits until it's unprotected.
    if (locked.has(String(sheet.sheetId))) {
      next.lockedTabs.push(scope.scopeId);
      next.problems.push({ scopeId: scope.scopeId, message: `"${sheet.title}" is protected in the sheet, so Survey can't write to it and isn't syncing it. Nothing is lost: its changes go in once it's unprotected.` });
      continue;
    }
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    const remembered = next.headers[scope.scopeId] || {};
    const headerAt = findHeaderRow(scope, rows, remembered);
    const header = rows[headerAt] || [];
    const { colOfKey, renamed } = mapHeader(scope, header, remembered);
    const where = (r) => `Row ${r + 1} in "${sheet.title}"`;
    // A column the template renamed keeps its place; its header follows the template.
    for (const column of renamed) {
      plan.headerAdds.push({ sheetId: sheet.sheetId, title: sheet.title, row: headerAt, col: colOfKey.get(column.key), header: column.header });
    }
    // New template columns (a checklist line added since the link) go on the
    // end of the header; a column someone deleted in the sheet stays deleted.
    const seen = new Set(next.columnsSeen[scope.scopeId] || []);
    // New headers go right of every used column, headed or not, so a column
    // of the PM's own with no header is never written over.
    let width = rows.reduce((w, row) => {
      let n = (row || []).length;
      while (n > 0 && isBlankCell(row[n - 1])) n -= 1;
      return Math.max(w, n);
    }, header.length);
    const addedKeys = new Set();
    for (const column of scope.columns) {
      if (!colOfKey.has(column.key) && !seen.has(column.key)) {
        addedKeys.add(column.key);
        plan.headerAdds.push({ sheetId: sheet.sheetId, title: sheet.title, row: headerAt, col: width, header: column.header });
        colOfKey.set(column.key, width);
        width += 1;
      }
      seen.add(column.key);
    }
    next.columnsSeen[scope.scopeId] = [...seen];
    // A column that had gone (deleted, or its header renamed) and is back
    // this round. When a PM puts a deleted column back blank, its blank cells
    // are not the PM clearing every value (real Excel, 11-10: all 8 notes of
    // a sheet were wiped): they count as unchanged, so the app fills them.
    const lastHeaders = state.headers?.[scope.scopeId];
    const backKeys = new Set(lastHeaders && Object.keys(lastHeaders).length
      ? scope.columns.filter((c) => colOfKey.has(c.key) && !addedKeys.has(c.key) && !(c.key in lastHeaders)
        && (state.columnsSeen?.[scope.scopeId] || []).includes(c.key)).map((c) => c.key)
      : []);
    next.headers[scope.scopeId] = Object.fromEntries(scope.columns.filter((c) => colOfKey.has(c.key)).map((c) => [c.key, c.header]));
    const rowIdCol = colOfKey.get('rowId');
    if (rowIdCol == null) {
      // Nothing is written to it, and what it last looked like is kept, so
      // an Undo in the sheet is picked up again as it was.
      next.brokenTabs.push(scope.scopeId);
      next.headers[scope.scopeId] = remembered;
      if (state.columnsSeen?.[scope.scopeId]) next.columnsSeen[scope.scopeId] = state.columnsSeen[scope.scopeId];
      plan.headerAdds = plan.headerAdds.filter((h) => !sameId(h.sheetId, sheet.sheetId));
      continue;
    }
    // Say so when a column stopped syncing because its header was renamed or
    // the column deleted in the sheet; silently dropping it hid lost edits.
    for (const column of scope.columns) {
      if (column.key !== 'rowId' && !colOfKey.has(column.key) && columnIsEditable(column)) {
        next.problems.push({ scopeId: scope.scopeId, message: `"${sheet.title}" has no "${column.header}" column (renamed or deleted in the sheet), so that column is not synced. Name a column "${column.header}" to sync it again.` });
      }
    }
    const mappedCols = new Set(colOfKey.values());
    // The list's own columns: Survey's, plus any headed column of the PM's
    // right next to them. When a PivotTable beside the list stops a
    // whole-row delete or insert (real Excel 11-10: every round failed),
    // rows are cut or opened across just these.
    let listCols = Math.max(...mappedCols) + 1;
    while (listCols < header.length && !isBlankCell(header[listCols])) listCols += 1;
    // Survey's own columns alone: the last resort when even those rows won't
    // move (a column added past the PivotTable).
    const ownCols = [...mappedCols].sort((a, b) => a - b);

    const sheetRecordOf = (row, base) => {
      const rec = { ...base, answers: { ...(base.answers || {}) } };
      for (const column of scope.columns) {
        if (!columnIsEditable(column) || !colOfKey.has(column.key)) continue;
        const raw = row[colOfKey.get(column.key)];
        if (isCellError(raw)) continue; // a failed formula tells us nothing about the value
        // A checkbox reads as the answer it means, so it never looks changed.
        setField(rec, column.key, checkboxCellAnswer(layout, column, raw) ?? cellText(raw));
      }
      return rec;
    };
    // What to put in a cell for `want`: a checkbox stays a checkbox (TRUE or
    // FALSE) when the answer is one it can show, instead of turning into "Y".
    const sheetWant = (key, want, was) => {
      if (typeof was !== 'boolean') return want;
      const column = scope.columns.find((c) => c.key === key);
      if (!isChoiceColumn(column)) return want;
      if (want === checkboxAnswerOf(layout.answerValues, true)) return true;
      if (want === (checkboxAnswerOf(layout.answerValues, false) ?? '')) return false;
      return want;
    };
    const writeCell = (rowIndex, key, value, was, markerId = null) => {
      const col = colOfKey.get(key);
      if (col == null) return;
      // Row ID writes carry the item's name, so a round whose rows moved
      // under it can find which row the Row ID belongs on.
      plan.cellWrites.push({ sheetId: sheet.sheetId, title: sheet.title, row: rowIndex, col, value, headerRow: headerAt, ...(markerId ? { markerId, key } : {}),
        ...(key === 'rowId' ? { rowIdFor: String(sheet.rows?.[rowIndex]?.[colOfKey.get('item')] ?? '').trim(), itemCol: colOfKey.get('item') ?? -1 } : {}) });
      plan.verify.push({ sheetId: sheet.sheetId, title: sheet.title, row: rowIndex, col, expect: was ?? null });
    };
    const rowFor = async (markerId, marker) => {
      const rec = appRecordOf(marker, scope, layout);
      const out = new Array(width).fill('');
      for (const column of scope.columns) {
        const col = colOfKey.get(column.key);
        if (col == null) continue;
        out[col] = column.key === 'rowId' ? await tokenFor(markerId, scope.scopeId) : cellValueFor(scope, column.key, rec);
      }
      return { out, rec };
    };

    const inThisScope = (m) => sameId(m?.moduleId, scope.moduleId) && sameId(m?.categoryId, scope.categoryId);
    // How many of the sheet's editable cells differ from what both sides last
    // agreed on (fields in the old fingerprint format compared in that format).
    const sheetChanges = async (row, fields) => {
      const sheetRec = sheetRecordOf(row, {});
      const fps = fieldPrintsOf(sheetRec);
      const legacy = fieldsOf(fields).some((k) => isLegacyPrint(getFp(fields, k)));
      const oldFps = legacy ? (await computeRowFingerprints(sheetRec)).fieldFingerprints : null;
      let n = 0;
      for (const c of scope.columns) {
        if (!columnIsEditable(c) || !colOfKey.has(c.key)) continue;
        if (isCellError(row[colOfKey.get(c.key)])) { n += 1; continue; }
        const was = getFp(fields, c.key);
        if (was != null && getFp(isLegacyPrint(was) ? oldFps : fps, c.key) !== was) n += 1;
      }
      return n;
    };
    const hasOwnData = (row) => row.some((c, i) => !mappedCols.has(i) && !isBlankCell(c));

    // Read every Row ID once. When a row was copied (Row ID and all), the copy
    // closest to what both sides last agreed on is the item's own row and the
    // others are new items, wherever the copy was pasted.
    const ids = new Map(); // r -> parsed Row ID or null
    const copies = new Map(); // markerId -> [r]
    for (let r = headerAt + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      if (isBlankRow(row)) continue;
      const token = cellText(row[rowIdCol]).trim();
      const parsed = token ? await identify(token) : null;
      ids.set(r, parsed);
      if (parsed && parsed.scopeId === scope.scopeId) copies.set(parsed.markerId, [...(copies.get(parsed.markerId) || []), r]);
    }
    const ownRow = new Map(); // markerId -> r
    for (const [markerId, list] of copies) {
      if (list.length < 2) { ownRow.set(markerId, list[0]); continue; }
      const fields = nextBaseline[markerId]?.fields;
      let best = list[0];
      if (fields) {
        let bestN = Infinity;
        for (const r of list) {
          const n = await sheetChanges(rows[r], fields);
          if (n < bestN) { bestN = n; best = r; }
        }
      }
      ownRow.set(markerId, best);
    }

    // Items of this tab that were in the sheet and have no row now, by name.
    // A row with a broken Row ID (typed over, cleared, pasted over) and one of
    // these names is that item's row, not a second item (real Excel 11-10:
    // a typo in the hidden Row ID made a duplicate of the item in Survey).
    const lostByName = new Map();
    for (const markerId of markersByScope.get(scope.scopeId) || []) {
      // An item already gone from the sheet in an earlier round is not
      // matched: a new row typed later with its name is a new item, not the
      // old one with its old answers.
      if (copies.has(markerId) || nextBaseline[markerId]?.scopeId !== scope.scopeId || next.tombstones[markerId] || state.removedInSheet?.[markerId]) continue;
      const name = String(markers[markerId]?.name ?? '').trim().toLowerCase();
      if (!name) continue;
      lostByName.set(name, [...(lostByName.get(name) || []), markerId]);
    }

    const appendRows = [];
    // Rows that are not items (a totals line, a heading): new items go above
    // the ones after the last item, so a totals line stays last.
    const summaryRows = [];
    for (let r = headerAt + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      if (!ids.has(r)) continue; // blank
      const parsed = ids.get(r);
      const token = cellText(row[rowIdCol]).trim();
      let markerId = parsed?.markerId ?? null;

      // A row pasted here from another category's tab: left alone.
      if (markerId && parsed.scopeId !== scope.scopeId) {
        next.problems.push({ scopeId: scope.scopeId, message: `${where(r)}: this row belongs to another category's tab, so it was left alone.` });
        continue;
      }
      // A second copy of an item's row: a new item from the sheet (below).
      if (markerId && ownRow.get(markerId) !== r) markerId = null;

      const marker = markerId ? markers[markerId] : null;
      const tomb = markerId ? next.tombstones[markerId] : null;
      if (tomb && (typeof tomb !== 'object' || tomb.scopeId === scope.scopeId)) {
        if (!marker) continue; // deleted in the app, row kept on purpose
        if (!inThisScope(marker)) {
          next.problems.push({ markerId, scopeId: scope.scopeId, message: `${where(r)}: "${marker.name || 'An item'}" moved to another category in Survey. This row was kept because it had changes made in the sheet; copy them across and delete the row.` });
          continue;
        }
        delete next.tombstones[markerId]; // the delete was undone: the row is its own again
      }

      // A valid Row ID of an item deleted in the app whose row we removed: a
      // sheet put back from its version history. Left alone, never re-made.
      if (markerId && !marker && next.gone[markerId]) {
        next.problems.push({ markerId, scopeId: scope.scopeId, message: `${where(r)}: this row's item was deleted in Survey, so the row was left alone.` });
        continue;
      }
      // A valid Row ID with no marker and no baseline: the round that wrote it
      // stopped before the new marker was saved. Make the marker under that id.
      const recreate = markerId && !marker && !nextBaseline[markerId] && !plan.markerWrites[markerId];
      if (markerId && !marker && !recreate) {
        // Deleted in the app. Remove the row only if nobody changed it in the
        // sheet and it holds nothing of the sheet's own (a column the PM added).
        const base = nextBaseline[markerId];
        if (base) {
          if ((await sheetChanges(row, base.fields)) > 0 || hasOwnData(row)) {
            // Baseline kept, so an undo of the delete picks the row up again.
            next.tombstones[markerId] = { at: nowIso, scopeId: scope.scopeId };
          } else {
            plan.deletes.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, token, rowIdCol, listCols, ownCols });
            plan.summary.deleted += 1;
            delete nextBaseline[markerId];
            next.gone[markerId] = nowIso;
          }
        }
        continue;
      }

      if (marker && !inThisScope(marker)) {
        // Moved to another category in the app: its new tab gets a row (it
        // has none there), and this one goes, unless the sheet changed it or
        // it holds the PM's own columns; then it stays and says so.
        const base = baseline[markerId];
        const changed = base && base.scopeId === scope.scopeId && (await sheetChanges(row, base.fields)) > 0;
        if (changed || hasOwnData(row)) {
          next.tombstones[markerId] = { at: nowIso, scopeId: scope.scopeId };
          next.problems.push({ markerId, scopeId: scope.scopeId, message: `${where(r)}: "${marker.name || 'An item'}" moved to another category in Survey. This row was kept because it had changes made in the sheet; copy them across and delete the row.` });
          continue;
        }
        plan.verify.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, col: rowIdCol, token });
        plan.deletes.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, token, rowIdCol, listCols, ownCols });
        plan.summary.deleted += 1;
        continue;
      }
      if (marker && !seenMarkers.has(markerId)) {
        seenMarkers.add(markerId);
        delete next.removedInSheet[markerId];
        plan.verify.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, col: rowIdCol, token });
        await mergeRow({ markerId, marker, row, r });
        continue;
      }

      // No valid Row ID, or a second copy of a row: a new item from the sheet.
      // It needs a name: a heading or a totals line typed in another column
      // is not an item.
      const itemCol = colOfKey.get('item');
      if (!recreate && itemCol != null && isBlankCell(row[itemCol])) {
        summaryRows.push(r);
        // An Excel table's Total Row says "Total" in its first column, which
        // is Survey's hidden Row ID: a totals line, not a row to report.
        const first = row.find((c) => !isBlankCell(c));
        if (!TOTALS_LABEL.test(cellText(first).trim())) {
          next.problems.push({ scopeId: scope.scopeId, message: `${where(r)} has no "${scope.columns.find((c) => c.key === 'item')?.header || 'Item'}", so it was not brought in.` });
        }
        continue;
      }
      const lost = !parsed && itemCol != null ? lostByName.get(cellText(row[itemCol]).trim().toLowerCase()) : null;
      if (!recreate && lost?.length === 1 && markers[lost[0]] && !seenMarkers.has(lost[0])) {
        const found = lost[0];
        lostByName.delete(cellText(row[itemCol]).trim().toLowerCase());
        seenMarkers.add(found);
        delete next.removedInSheet[found];
        await mergeRow({ markerId: found, marker: markers[found], row, r });
        writeCell(r, 'rowId', await tokenFor(found, scope.scopeId), row[rowIdCol]);
        next.problems.push({ markerId: found, scopeId: scope.scopeId, message: `${where(r)}: its Row ID was changed, so Survey matched it to "${markers[found].name}" by name and put the Row ID back.` });
        continue;
      }
      // "Total", "Grand total", "Subtotal", "Sum"... typed under the items,
      // with no Row ID: the PM's own totals line, not an item.
      if (!token && itemCol != null && TOTALS_LABEL.test(cellText(row[itemCol]).trim())) {
        summaryRows.push(r);
        continue;
      }
      if (!recreate && newRowsLeft <= 0) { newRowsWaiting += 1; continue; }
      if (!recreate) newRowsLeft -= 1;
      const id = recreate ? markerId : newMarkerId();
      const conv = {};
      const fresh = {
        id,
        name: '',
        moduleId: scope.moduleId,
        categoryId: scope.categoryId,
        checklistResponses: {},
        note: {},
        changedBy: sheetEditor,
        changedDate: nowIso,
        pageNumber: null,
        bounds: null,
        source: 'sheet',
      };
      for (const column of scope.columns) {
        if (!columnIsEditable(column) || !colOfKey.has(column.key)) continue;
        const c = sheetCellToApp(layout, column, row[colOfKey.get(column.key)]);
        if (c.error) {
          next.problems.push({ markerId: id, scopeId: scope.scopeId, message: `${where(r)}: ${c.error}` });
          continue;
        }
        conv[column.key] = c;
        applyFieldToMarker(fresh, column.key, c, nowIso);
      }
      if (!fresh.name) fresh.name = 'New item';
      plan.markerWrites[id] = fresh;
      plan.summary.created += 1;
      const rec = appRecordOf(fresh, scope, layout);
      nextBaseline[id] = { scopeId: scope.scopeId, fields: fieldPrintsOf(rec) };
      // The row gets its Row ID, and the app's own cells (dates, tidied values).
      plan.verify.push({ sheetId: sheet.sheetId, title: sheet.title, row: r, col: rowIdCol, token });
      if (!recreate) writeCell(r, 'rowId', await tokenFor(id, scope.scopeId), row[rowIdCol]);
      seenMarkers.add(id);
      for (const column of scope.columns) {
        if (column.key === 'rowId' || !colOfKey.has(column.key)) continue;
        if (columnIsEditable(column) && conv[column.key] === undefined) continue; // a bad value stays for the person to fix
        const was = row[colOfKey.get(column.key)];
        const want = sheetWant(column.key, cellValueFor(scope, column.key, rec), was);
        if (!sameCell(was, want)) writeCell(r, column.key, want, was);
      }
    }

    // Markers of this category with no row.
    for (const markerId of markersByScope.get(scope.scopeId) || []) {
      if (seenMarkers.has(markerId)) continue;
      const base = nextBaseline[markerId];
      const putBack = next.choices[markerId] === 'putBack';
      if (base && base.scopeId === scope.scopeId && !putBack) {
        // Deleted in the sheet: never delete the marker; list it.
        if (!next.removedInSheet[markerId]) next.removedInSheet[markerId] = { at: nowIso, name: String(markers[markerId]?.name || '') };
        continue;
      }
      delete next.removedInSheet[markerId];
      delete next.choices[markerId];
      delete next.tombstones[markerId];
      const { out, rec } = await rowFor(markerId, markers[markerId]);
      appendRows.push(out);
      nextBaseline[markerId] = { scopeId: scope.scopeId, fields: fieldPrintsOf(rec) };
      seenMarkers.add(markerId);
      plan.summary.appended += 1;
      if (lateSaves && scopesWithItems.has(scope.scopeId)) next.recentWrites[`${markerId}|+row`] = { t: now.getTime() };
    }
    const notItems = new Set(summaryRows);
    let lastItemRow = headerAt;
    for (const r of ids.keys()) if (!notItems.has(r) && r > lastItemRow) lastItemRow = r;
    // Only a line just under the items (two blank rows at most) is their
    // totals line. A note a PM typed far below (Z400) is not: new items
    // inserted above it landed at row 400 (real Excel 11-10).
    const firstSummary = summaryRows.filter((r) => r > lastItemRow && r <= lastItemRow + 3).sort((a, b) => a - b)[0];
    if (appendRows.length) {
      plan.appends.push({
        sheetId: sheet.sheetId, title: sheet.title, rows: appendRows, width, listCols, ownCols,
        ...(firstSummary != null ? { before: firstSummary } : {}),
      });
    }

    // ---- one matched row -------------------------------------------------
    async function mergeRow({ markerId, marker, row, r }) {
      let base = nextBaseline[markerId]?.fields || null;
      const appRec = appRecordOf(marker, scope, layout);
      const appFps = fieldPrintsOf(appRec);
      const sheetRec = sheetRecordOf(row, appRec);
      const sheetFps = fieldPrintsOf(sheetRec);
      const keys = scope.columns.filter((c) => c.key !== 'rowId').map((c) => c.key);
      // Fields saved in the old format are compared in it until rewritten.
      const legacyKeys = base ? keys.filter((k) => isLegacyPrint(getFp(base, k))) : [];
      if (legacyKeys.length) {
        const oldApp = (await computeRowFingerprints(appRec)).fieldFingerprints;
        const oldSheet = (await computeRowFingerprints(sheetRec)).fieldFingerprints;
        for (const k of legacyKeys) { setFp(appFps, k, getFp(oldApp, k)); setFp(sheetFps, k, getFp(oldSheet, k)); }
      }
      // Fields the sheet does not show (column deleted, read-only, or a
      // formula showing an error) count as unchanged there, so only the app's
      // change to them is kept.
      const sheetSide = JSON.parse(JSON.stringify(sheetFps));
      const errorKeys = new Set();
      // A cell that would not keep Survey's last write (merged cells) and is
      // still blank: blank is not the PM clearing it, so it counts as
      // unchanged and is not written again. Once it holds a value it syncs.
      const stuckKeys = new Set();
      for (const key of keys) {
        const flag = `${markerId}|${key}`;
        if (!next.stuck[flag]) continue;
        if (colOfKey.has(key) && isBlankCell(row[colOfKey.get(key)])) stuckKeys.add(key);
        else delete next.stuck[flag];
      }
      for (const key of keys) {
        const column = scope.columns.find((c) => c.key === key);
        const errored = colOfKey.has(key) && isCellError(row[colOfKey.get(key)]);
        if (errored) errorKeys.add(key);
        if (stuckKeys.has(key)) {
          setFp(sheetSide, key, base ? getFp(base, key) : getFp(appFps, key));
          continue;
        }
        // A column added this round is blank in the sheet: nothing changed
        // there yet. Nor in a blank cell of a column that came back.
        const backBlank = backKeys.has(key) && isBlankCell(row[colOfKey.get(key)]);
        if (!columnIsEditable(column) || !colOfKey.has(key) || addedKeys.has(key) || errored || backBlank) {
          setFp(sheetSide, key, base ? getFp(base, key) : getFp(appFps, key));
        }
      }
      // The sheet blanked a filled answer the app has not changed since both
      // last agreed: counted, and held or put back (see eraseMode).
      const heldKeys = new Set();
      if (base) {
        for (const key of keys) {
          const column = scope.columns.find((c) => c.key === key);
          if (stuckKeys.has(key) || errorKeys.has(key) || addedKeys.has(key) || !columnIsEditable(column) || !colOfKey.has(key)) continue;
          if (!isBlankCell(row[colOfKey.get(key)]) || isBlankCell(cellValueFor(scope, key, appRec))) continue;
          if (getFp(appFps, key) !== getFp(base, key) || getFp(sheetSide, key) === getFp(base, key)) continue;
          erasing += 1;
          erasingItems.add(markerId);
          erasingScopes.add(scope.scopeId);
          if (eraseMode === 'hold' || eraseMode === 'restore') setFp(sheetSide, key, getFp(base, key));
          if (eraseMode === 'hold') heldKeys.add(key);
        }
      }
      // A PM's new row saved late over the row Survey had just appended for
      // a field tech's item (NEW_ROW_TAKEOVER_MS): the cells the PM typed
      // become a new item in the next row, and the tech's values go back.
      if (base && lateSaves && colOfKey.has('item')) {
        const fresh = next.recentWrites[`${markerId}|+row`];
        const typedName = cellText(row[colOfKey.get('item')]).trim();
        if (fresh && !fresh.took && now.getTime() - Number(fresh.t) <= NEW_ROW_TAKEOVER_MS && typedName
          && getFp(sheetSide, 'item') !== getFp(base, 'item') && getFp(appFps, 'item') === getFp(base, 'item')) {
          const typedKeys = keys.filter((k) => {
            const column = scope.columns.find((c) => c.key === k);
            return columnIsEditable(column) && colOfKey.has(k) && !errorKeys.has(k)
              && getFp(sheetSide, k) !== getFp(base, k) && getFp(appFps, k) === getFp(base, k);
          });
          const id = newMarkerId();
          const item = {
            id, name: '', moduleId: scope.moduleId, categoryId: scope.categoryId, checklistResponses: {}, note: {},
            changedBy: sheetEditor, changedDate: nowIso, pageNumber: null, bounds: null, source: 'sheet',
          };
          for (const k of typedKeys) {
            const conv = sheetCellToApp(layout, scope.columns.find((c) => c.key === k), row[colOfKey.get(k)]);
            if (conv.error) { next.problems.push({ markerId: id, scopeId: scope.scopeId, message: `${where(r)}: ${conv.error}` }); continue; }
            applyFieldToMarker(item, k, conv, nowIso);
          }
          if (!item.name) item.name = typedName;
          plan.markerWrites[id] = item;
          plan.summary.created += 1;
          const made = await rowFor(id, item);
          appendRows.push(made.out);
          plan.summary.appended += 1;
          nextBaseline[id] = { scopeId: scope.scopeId, fields: fieldPrintsOf(made.rec) };
          seenMarkers.add(id);
          next.recentWrites[`${id}|+row`] = { t: now.getTime() };
          for (const k of typedKeys) setFp(sheetSide, k, getFp(base, k));
          // Still watched (the rest of that save may land later), but split once.
          next.recentWrites[`${markerId}|+row`] = { ...fresh, took: true };
          next.problems.push({ markerId: id, scopeId: scope.scopeId, message: `${where(r)}: "${typedName}" was typed into the row Survey had just filled with "${String(marker.name || '')}" for a field tech. Both are kept: "${typedName}" is a new item in the row below.` });
        }
      }
      // A late save landing on a cell Survey just wrote, while the app still
      // holds what Survey wrote: compared against the value from before
      // Survey's write, so it is held as a conflict (and stays held, since the
      // baseline keeps that value) instead of replacing the app's value.
      if (base && lateSaves) {
        let copied = false;
        // Cells of a row Survey appended count as written over a blank cell,
        // so a late PM value on a filled one (a note typed into that empty
        // row) is held too; on a cell Survey left blank it just comes in.
        const appended = next.recentWrites[`${markerId}|+row`];
        const blankPrints = appended && now.getTime() - Number(appended.t) <= NEW_ROW_TAKEOVER_MS ? fieldPrintsOf({}) : null;
        for (const key of keys) {
          let w = next.recentWrites[`${markerId}|${key}`];
          if (!w && blankPrints && getFp(base, key) !== getFp(blankPrints, key)) w = { wrote: getFp(base, key), was: getFp(blankPrints, key) };
          if (!w) continue;
          const wrote = getFp(base, key);
          if (w.wrote !== wrote || getFp(appFps, key) !== wrote) continue;
          const sheetNow = getFp(sheetSide, key);
          if (sheetNow === wrote || sheetNow === (w.was ?? null)) continue;
          if (!copied) { base = JSON.parse(JSON.stringify(base)); copied = true; }
          setFp(base, key, w.was ?? null);
        }
      }
      const { conflictFields, excelChangedFields, appChangedFields } = detectFieldConflicts({
        baseline: base || {},
        appNow: appFps,
        excelIn: sheetSide,
      });
      // The tracking cells, which the Excel import's field list (shared with
      // the app, so left as it is) does not know: the same rule, here.
      for (const k of TRACKING_KEYS) {
        const was = base?.[k];
        const appSide = appFps[k] !== was;
        const sheetSideChanged = sheetSide[k] !== was;
        if (appSide) appChangedFields.push(k);
        if (sheetSideChanged) excelChangedFields.push(k);
        if (appSide && sheetSideChanged && appFps[k] !== sheetSide[k]) conflictFields.push(k);
      }
      const appChangedSet = new Set(appChangedFields);
      const choice = next.choices[markerId];
      const conflicts = new Set(conflictFields.filter((k) => keys.includes(k)));
      const fromSheet = new Set(excelChangedFields.filter((k) => keys.includes(k) && !conflicts.has(k)));
      if (choice === 'sheet') conflicts.forEach((k) => fromSheet.add(k));
      if (choice === 'app' || choice === 'sheet') conflicts.clear();
      if (choice) delete next.choices[markerId]; // a 'putBack' is done once the row is here

      const updated = JSON.parse(JSON.stringify(marker));
      const bad = new Set();
      let appChanged = false;
      for (const key of fromSheet) {
        const column = scope.columns.find((c) => c.key === key);
        const conv = sheetCellToApp(layout, column, row[colOfKey.get(key)]);
        if (conv.error) {
          bad.add(key);
          next.problems.push({ markerId, scopeId: scope.scopeId, message: `${where(r)}: ${conv.error}` });
          continue;
        }
        if (canonicalizeCellValue(getField(appRec, key) ?? '') === canonicalizeCellValue(conv.value)) continue;
        applyFieldToMarker(updated, key, conv, nowIso);
        appChanged = true;
        plan.summary.toApp += 1;
      }
      for (const key of errorKeys) {
        if (!appChangedSet.has(key)) {
          next.problems.push({ markerId, scopeId: scope.scopeId, message: `${where(r)}: "${scope.columns.find((c) => c.key === key)?.header || key}" shows ${row[colOfKey.get(key)].error}, so it was skipped` });
        }
      }
      if (appChanged) {
        updated.changedBy = sheetEditor;
        updated.changedDate = nowIso;
        plan.markerWrites[markerId] = updated;
      }

      const finalRec = appChanged ? appRecordOf(updated, scope, layout) : appRec;
      const finalFps = fieldPrintsOf(finalRec);
      const nextFields = base ? JSON.parse(JSON.stringify(base)) : {};
      for (const key of keys) {
        if (conflicts.has(key) || bad.has(key)) continue;
        // A formula showing an error, unchanged in the app: leave the person's
        // formula and the agreed value alone.
        if (errorKeys.has(key) && !appChangedSet.has(key)) continue;
        setFp(nextFields, key, getFp(finalFps, key));
        const col = colOfKey.get(key);
        if (col == null) continue;
        if (heldKeys.has(key)) continue; // left blank in the sheet until an editor chooses
        if (stuckKeys.has(key)) {
          if (!isBlankCell(cellValueFor(scope, key, finalRec))) {
            next.problems.push({ markerId, scopeId: scope.scopeId, message: `${where(r)}: "${scope.columns.find((c) => c.key === key)?.header || key}" is inside merged cells, so Survey can't fill it in. Unmerge those cells to sync it.` });
          }
          continue;
        }
        const want = sheetWant(key, cellValueFor(scope, key, finalRec), row[col]);
        if (!sameCell(row[col], want)) {
          writeCell(r, key, want, row[col], markerId);
          if (!fromSheet.has(key)) {
            plan.summary.toSheet += 1;
            if (base && lateSaves && !isLegacyPrint(getFp(base, key))) next.recentWrites[`${markerId}|${key}`] = { t: now.getTime(), was: getFp(base, key), wrote: getFp(finalFps, key) };
          }
        }
      }
      // Answers the layout no longer has stay in the baseline: a device still
      // on the older template must not make them look changed on both sides.
      nextBaseline[markerId] = { scopeId: scope.scopeId, fields: nextFields };

      if (conflicts.size) {
        const fields = [...conflicts].sort();
        next.conflicts[markerId] = {
          scopeId: scope.scopeId,
          name: String(marker.name || ''),
          fields: fields.map((key) => ({
            key,
            header: scope.columns.find((c) => c.key === key)?.header || key,
            app: displayOf(getField(appRec, key)),
            sheet: displayOf(row[colOfKey.get(key)]),
          })),
          at: next.conflicts[markerId]?.at || nowIso,
        };
        plan.summary.conflicts += 1;
      } else {
        delete next.conflicts[markerId];
      }
    }
  }

  if (newRowsWaiting) {
    next.problems.unshift({ message: `${newRowsWaiting} more new rows from the sheet come in over the next rounds (at most ${MAX_NEW_ROWS_PER_ROUND} a round).` });
  }

  // Items deleted in the app whose row went: remembered (newest 5,000) so a
  // sheet restored from its history cannot bring them back.
  const goneIds = Object.keys(next.gone);
  if (goneIds.length > 5000) {
    goneIds.sort((a, b) => String(next.gone[a]).localeCompare(String(next.gone[b])));
    for (const id of goneIds.slice(0, goneIds.length - 5000)) delete next.gone[id];
  }
  // At most 200 problems, each short: they are saved with the link and sent
  // with every status, and a sheet can hold any amount of text.
  next.problems = next.problems.slice(0, 200).map((p) => ({ ...p, message: displayOf(p.message) }));

  // Conflicts and lists of markers that no longer exist go away.
  for (const id of Object.keys(next.conflicts)) if (!markers[id]) delete next.conflicts[id];
  for (const id of Object.keys(next.removedInSheet)) if (!markers[id]) delete next.removedInSheet[id];
  for (const id of Object.keys(next.choices)) if (!markers[id]) delete next.choices[id];
  // An item deleted in the app while its tab is locked keeps its baseline,
  // so its row is taken out once unlocked instead of coming back as new.
  const lockedScopes = new Set(next.lockedTabs);
  for (const id of Object.keys(nextBaseline)) {
    if (!markers[id] && !plan.markerWrites[id] && !next.tombstones[id] && !lockedScopes.has(nextBaseline[id]?.scopeId)) delete nextBaseline[id];
  }

  for (const flag of Object.keys(next.stuck)) if (!markers[flag.split('|')[0]]) delete next.stuck[flag];
  // A locked tab's rows weren't looked at: a held erase with blanks on it,
  // and an editor's choice about that erase, wait for the tab instead of
  // being used up or dropped. Dropped, its blanks would come in as plain
  // edits once it's unlocked if fewer than BIG_ERASE were left. A hold saved
  // before it named its tabs counts as on every tab.
  const lockedNow = new Set(next.lockedTabs);
  const heldOn = Array.isArray(state.heldErase?.scopes) ? state.heldErase.scopes : null;
  const waitsOnLocked = Boolean(state.heldErase) && lockedNow.size > 0
    && (heldOn === null || heldOn.some((id) => lockedNow.has(id)));
  if (waitsOnLocked && state.eraseChoice) next.eraseChoice = state.eraseChoice;
  else delete next.eraseChoice; // used once
  const lockedPart = waitsOnLocked ? (heldOn === null ? [...lockedNow] : heldOn.filter((id) => lockedNow.has(id))) : [];
  const was = waitsOnLocked ? state.heldErase : {};
  if ((eraseMode === 'hold' && erasing) || waitsOnLocked) {
    next.heldErase = {
      count: Math.max(eraseMode === 'hold' ? erasing : 0, waitsOnLocked ? was.count || 0 : 0),
      items: Math.max(eraseMode === 'hold' ? erasingItems.size : 0, waitsOnLocked ? was.items || 0 : 0),
      scopes: [...new Set([...(eraseMode === 'hold' ? erasingScopes : []), ...lockedPart])],
      at: state.heldErase?.at || nowIso,
    };
  } else {
    delete next.heldErase;
  }
  plan.erasing = erasing;
  return { ...plan, baseline: nextBaseline, state: next };
}
