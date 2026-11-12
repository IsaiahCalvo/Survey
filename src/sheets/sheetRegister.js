// Sheet register (Nightly flag 'sheet-register', Drawboard Projects parity
// item 9): the Home list as a drawing register. Each row shows its sheet
// number, revision and discipline; the list searches and sorts by sheet
// number, filters by discipline and by open issues or tasks, and exports as
// a CSV. Pure rules only; SheetRegisterBits.jsx and DocumentsLedger.jsx draw
// them, sheetRegisterData.js reads and writes the server.
import { displaySheetNumber, readSheetFromFileName } from '../utils/titleBlock.js';

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const clean = (value) => String(value ?? '').trim();

/* The US National CAD Standard's discipline letters (the first letters of a
   sheet number: A-101 is Architectural). Two-letter codes are checked first. */
const TWO_LETTER = {
  FP: 'Fire Protection',
  FA: 'Fire Alarm',
  ID: 'Interiors',
  LS: 'Life Safety',
  AD: 'Architectural',
  ME: 'Mechanical',
  EL: 'Electrical',
  PL: 'Plumbing',
  SK: 'Sketch',
};
const ONE_LETTER = {
  G: 'General',
  H: 'Hazardous Materials',
  V: 'Survey',
  B: 'Geotechnical',
  C: 'Civil',
  L: 'Landscape',
  S: 'Structural',
  A: 'Architectural',
  I: 'Interiors',
  Q: 'Equipment',
  F: 'Fire Protection',
  P: 'Plumbing',
  D: 'Process',
  M: 'Mechanical',
  E: 'Electrical',
  T: 'Telecommunications',
  R: 'Resource',
  X: 'Other',
  Z: 'Contractor',
  O: 'Operations',
};

/** The disciplines a person can pick (Edit details, bulk Discipline). */
export const DISCIPLINES = Object.freeze([
  'General', 'Civil', 'Landscape', 'Structural', 'Architectural', 'Interiors',
  'Equipment', 'Fire Protection', 'Fire Alarm', 'Life Safety', 'Plumbing',
  'Mechanical', 'Electrical', 'Telecommunications', 'Survey', 'Geotechnical',
  'Process', 'Hazardous Materials', 'Resource', 'Operations', 'Contractor', 'Other',
]);
export const DISCIPLINE_MAX_LENGTH = 40;
export const SHEET_NUMBER_MAX_LENGTH = 40;
export const SHEET_REVISION_MAX_LENGTH = 12;

/** "A-101" -> "Architectural"; "FP-2" -> "Fire Protection"; '' when unknown. */
export function disciplineFromNumber(number) {
  const m = /^([A-Za-z]{1,2})(?=[-. _]?\d)/.exec(clean(number));
  if (!m) return '';
  const letters = m[1].toUpperCase();
  if (letters.length === 2 && TWO_LETTER[letters]) return TWO_LETTER[letters];
  return ONE_LETTER[letters[0]] || '';
}

// Stored numbers come from the title-block reader as "A101"; a typed one is
// kept as typed ("A-101", "SEC-A01").
function shownNumber(stored) {
  const value = clean(stored);
  if (!value) return '';
  return /^[A-Z]{1,2}\d/.test(value) && !/[-. ]/.test(value) ? displaySheetNumber(value) : value;
}

/**
 * The register fields of one document: its sheet number (saved, else read
 * from the file name), revision, discipline (picked, else from the number)
 * and whether the discipline was picked.
 * `extra` = { discipline } from the server; `edit` = a local Edit details
 * that the list's documents have not caught up with yet.
 */
export function sheetInfo(doc, extra = null, edit = null) {
  const fromName = readSheetFromFileName(doc?.name);
  const hasEdit = edit && Object.prototype.hasOwnProperty.call(edit, 'sheetNumber');
  const storedNumber = hasEdit ? edit.sheetNumber : doc?.sheet_number;
  const number = shownNumber(storedNumber) || (hasEdit ? '' : shownNumber(fromName.sheetNumber));
  const storedRevision = edit && Object.prototype.hasOwnProperty.call(edit, 'revision') ? edit.revision : doc?.sheet_revision;
  const revision = clean(storedRevision) || (edit && Object.prototype.hasOwnProperty.call(edit, 'revision') ? '' : clean(fromName.revision));
  const picked = clean(extra?.discipline);
  return {
    number,
    revision,
    discipline: picked || disciplineFromNumber(number),
    disciplinePicked: Boolean(picked),
  };
}

const squash = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Search over the name, the sheet number ("a101" finds "A-101") and the discipline. */
export function matchesRegisterSearch(info, query) {
  const q = clean(query).toLowerCase();
  if (!q) return true;
  if (!info) return false;
  const sq = squash(q);
  if (sq && squash(info.number).includes(sq)) return true;
  return clean(info.discipline).toLowerCase().includes(q);
}

/* Filters. Discipline: one discipline, or '' for "No discipline". Open items:
   'with' (one or more open issues or tasks link the sheet) or 'without'. */
export const EMPTY_REGISTER_FILTER = Object.freeze({ discipline: null, openItems: null });
export const registerFilterIsEmpty = (f) => !f || (f.discipline == null && !f.openItems);

export function passesRegisterFilter(info, openItems, filter) {
  if (!filter) return true;
  if (filter.discipline != null && clean(info?.discipline) !== filter.discipline) return false;
  const open = Number(openItems) || 0;
  if (filter.openItems === 'with' && open < 1) return false;
  if (filter.openItems === 'without' && open > 0) return false;
  return true;
}

/** Disciplines in the list with how many sheets each, most first; '' = none. */
export function disciplineCounts(infos) {
  const counts = new Map();
  for (const info of infos || []) {
    const key = clean(info?.discipline);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([discipline, count]) => ({ discipline, count }))
    .sort((a, b) => (a.discipline === '' ? 1 : 0) - (b.discipline === '' ? 1 : 0) || b.count - a.count || COLLATOR.compare(a.discipline, b.discipline));
}

/* Sorts the register adds to Home's: sheet number (numbers read as numbers,
   A-2 before A-10; sheets with no number after every numbered one) and
   review status (in the review's own order; no status last). */
export const REGISTER_SORTS = [
  ['sheet', 'Sheet number'],
  ['status', 'Status'],
];

export function compareSheetNumbers(a, b) {
  const x = clean(a);
  const y = clean(b);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return COLLATOR.compare(x, y);
}

/**
 * Sort rows by 'sheet' or 'status'. `infoOf(row)` gives the row's
 * sheetInfo; `statusRank(row)` its status order (Infinity for none).
 * Ties fall back to the name.
 */
export function sortRegisterRows(rows, key, dir, { infoOf, statusRank } = {}) {
  const sign = dir === 'desc' ? -1 : 1;
  const name = (r) => clean(r?.name);
  const list = [...(rows || [])];
  if (key === 'sheet') {
    return list.sort((a, b) => {
      const x = infoOf(a).number;
      const y = infoOf(b).number;
      if (!x !== !y) return x ? -1 : 1;
      return sign * compareSheetNumbers(x, y) || COLLATOR.compare(name(a), name(b));
    });
  }
  if (key === 'status') {
    return list.sort((a, b) => {
      const x = statusRank(a);
      const y = statusRank(b);
      const xNone = !Number.isFinite(x);
      const yNone = !Number.isFinite(y);
      if (xNone !== yNone) return xNone ? 1 : -1;
      return (xNone ? 0 : sign * (x - y)) || COLLATOR.compare(name(a), name(b));
    });
  }
  return list;
}

/** The Edit details form, checked: trimmed values, or the first problem. */
export function checkSheetDetails({ number = '', name = '', revision = '', discipline = '' } = {}) {
  const out = { number: clean(number), name: clean(name), revision: clean(revision), discipline: clean(discipline) };
  if (!out.name) return { error: 'Give the drawing a name.' };
  if (out.number.length > SHEET_NUMBER_MAX_LENGTH) return { error: `Keep the sheet number to ${SHEET_NUMBER_MAX_LENGTH} characters.` };
  if (out.revision.length > SHEET_REVISION_MAX_LENGTH) return { error: `Keep the revision to ${SHEET_REVISION_MAX_LENGTH} characters.` };
  if (out.discipline.length > DISCIPLINE_MAX_LENGTH) return { error: `Keep the discipline to ${DISCIPLINE_MAX_LENGTH} characters.` };
  return { value: out };
}

/* Drawing list CSV (Drawboard's "Export Drawing List"). A cell that starts
   with = + - @ (or a tab / return) is prefixed with ' so a spreadsheet never
   runs it as a formula; quotes are doubled. */
export const REGISTER_CSV_COLUMNS = [
  'Sheet number', 'Name', 'Revision', 'Discipline', 'Status', 'Assignee',
  'Markups', 'Open items', 'Tags', 'Project', 'Uploaded', 'Uploaded by', 'Last edited', 'Version',
];

export function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const isoDay = (ms) => {
  const t = Number(ms) || 0;
  if (!t) return '';
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * rows: [{ number, name, revision, discipline, status, assignee, markups,
 * openItems, tags, project, uploadedMs, uploadedBy, editedMs, version }]
 * -> CSV text with a header row and CRLF line ends (what Excel expects).
 */
export function registerCsv(rows) {
  const lines = [REGISTER_CSV_COLUMNS.map(csvCell).join(',')];
  for (const r of rows || []) {
    lines.push([
      r.number, r.name, r.revision, r.discipline, r.status, r.assignee,
      r.markups == null ? '' : r.markups, Number(r.openItems) || 0,
      (r.tags || []).join('; '), r.project, isoDay(r.uploadedMs), r.uploadedBy,
      isoDay(r.editedMs), r.version == null ? '' : r.version,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** "Drawing list 2026-11-12.csv" */
export function registerCsvName(now = Date.now()) {
  return `Drawing list ${isoDay(now)}.csv`;
}
