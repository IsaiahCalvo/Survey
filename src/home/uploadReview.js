// Upload review (Nightly flag 'upload-review'; Drawboard Projects parity
// UP-10..23). Drawboard's "Review & Publish" is a grid: one row per sheet
// with a crop of its title block beside the fields it read, rows picked for
// bulk edits (revision, discipline), a Show filter (All / Problems / No
// discipline), rows removed before publishing, a red flag on a sheet number
// and revision that are already uploaded, and a multi-page PDF turned into
// one drawing per page. This builds on the upload check (uploadCheck.js):
// same row fields, plus fileIndex / page / pageCount / discipline / crop.
// Pure: no React, no Supabase, so node tests import it.

import { disciplineFromNumber } from '../sheets/sheetRegister.js';
import { uploadCheckProblems, uploadFileName, uploadSheet, withSheetReading } from './uploadCheck.js';

export const MAX_SPLIT_PAGES = 200;

const stripPdf = (name) => String(name || '').replace(/\.pdf$/i, '');
const squash = (value) => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/** One row per picked file, before anything is read. */
export function reviewRows(files) {
  return (files || []).map((file, index) => ({
    key: `${index}:${file?.name || ''}`,
    fileIndex: index,
    page: null,
    pageCount: null,
    fileName: file?.name || '',
    name: stripPdf(file?.name).trim(),
    sheet: '',
    revision: '',
    discipline: '',
    reading: true,
    source: null,
    crop: null,
  }));
}

/** Fill a row from readUploadPage's answer, keeping anything already typed. */
export function withReviewReading(row, reading) {
  if (!row) return row;
  return {
    ...withSheetReading(row, reading),
    pageCount: row.page ? row.pageCount : (Number(reading?.pageCount) || row.pageCount || null),
    crop: reading?.crop || row.crop || null,
  };
}

/** The discipline a row saves with: the one picked, else the sheet number's. */
export const rowDiscipline = (row) => String(row?.discipline || '').trim() || disciplineFromNumber(row?.sheet);

/** Can this row become one drawing per page? */
export const canSplit = (row) => !row?.page && Number(row?.pageCount) > 1 && Number(row.pageCount) <= MAX_SPLIT_PAGES;

/**
 * "One document per page": the file's row becomes one row per page, each to
 * be read again from its own page. Names get " - p3" so they stay apart.
 */
export function splitRows(rows, fileIndex) {
  const out = [];
  for (const row of rows || []) {
    if (row.fileIndex !== fileIndex || !canSplit(row)) { out.push(row); continue; }
    const base = stripPdf(row.name).trim() || stripPdf(row.fileName);
    for (let page = 1; page <= row.pageCount; page += 1) {
      out.push({
        ...row,
        key: `${fileIndex}:p${page}`,
        page,
        name: `${base} - p${page}`,
        sheet: '',
        revision: '',
        discipline: row.discipline,
        reading: true,
        source: null,
        crop: null,
      });
    }
  }
  return out;
}

/** Back to one row for the file (its first page's row keeps its typed name base). */
export function joinRows(rows, fileIndex) {
  const out = [];
  let joined = false;
  for (const row of rows || []) {
    if (row.fileIndex !== fileIndex || !row.page) { out.push(row); continue; }
    if (joined) continue;
    joined = true;
    out.push({
      ...row,
      key: `${fileIndex}:${row.fileName}`,
      page: null,
      name: stripPdf(row.fileName).trim(),
      sheet: '',
      revision: '',
      reading: true,
      source: null,
      crop: null,
    });
  }
  return out;
}

/** Apply one field patch to the picked rows. */
export function patchRows(rows, keys, patch) {
  const pick = new Set(keys || []);
  return (rows || []).map((row) => (pick.has(row.key) ? { ...row, ...patch } : row));
}

export const removeRows = (rows, keys) => {
  const drop = new Set(keys || []);
  return (rows || []).filter((row) => !drop.has(row.key));
};

/**
 * Errors stop the upload (no name, two rows with one name). Warnings do not:
 * a sheet number + revision already uploaded (`existing`: [{ sheet_number,
 * sheet_revision, name }]) or given twice in this batch.
 * -> { errors: { key: msg }, warnings: { key: msg } }
 */
export function reviewProblems(rows, existing = []) {
  const errors = uploadCheckProblems(rows);
  const warnings = {};
  const uploaded = new Map();
  for (const doc of existing || []) {
    const n = squash(doc?.sheet_number);
    const r = squash(doc?.sheet_revision);
    if (n && r) uploaded.set(`${n}|${r}`, doc);
  }
  const batch = new Map();
  for (const row of rows || []) {
    if (errors[row.key]) continue;
    const n = squash(row.sheet);
    const r = squash(row.revision);
    if (!n || !r) continue;
    const id = `${n}|${r}`;
    const shown = `${String(row.sheet).trim()} revision ${String(row.revision).trim()}`;
    if (uploaded.has(id)) warnings[row.key] = `${shown} is already uploaded. Check the revision.`;
    else if (batch.has(id)) warnings[row.key] = `${shown} is in this upload twice.`;
    else batch.set(id, row.key);
  }
  return { errors, warnings };
}

export const REVIEW_SHOWS = [
  ['all', 'All'],
  ['problems', 'Problems'],
  ['no-discipline', 'No discipline'],
];

export function rowShown(row, show, problems) {
  if (show === 'problems') return Boolean(problems?.errors?.[row.key] || problems?.warnings?.[row.key]);
  if (show === 'no-discipline') return !row.reading && !rowDiscipline(row);
  return true;
}

export function showCounts(rows, problems) {
  const counts = {};
  for (const [key] of REVIEW_SHOWS) counts[key] = (rows || []).filter((row) => rowShown(row, key, problems)).length;
  return counts;
}

/**
 * What the upload gets: one entry per row, in order:
 * { fileIndex, page, fileName, sheet } with sheet = uploadSheet(row) plus the
 * discipline picked (null = from the number, saved as nothing).
 */
export function reviewResult(rows) {
  return (rows || []).map((row) => {
    const base = uploadSheet(row);
    const discipline = String(row.discipline || '').trim() || null;
    const sheet = base || discipline ? { sheetNumber: null, sheetLabel: null, revision: null, ...(base || {}), discipline } : null;
    return { fileIndex: row.fileIndex, page: row.page || null, fileName: uploadFileName(row), sheet };
  });
}

/**
 * Where to crop a page for its title-block picture: around the piece that
 * gave the sheet number, else the bottom-right corner. Page units, y down.
 * -> { x, y, w, h }
 */
export function titleBlockCropBox(page, piece = null) {
  const W = Number(page?.width) || 0;
  const H = Number(page?.height) || 0;
  if (!W || !H) return null;
  const w = Math.min(W, Math.max(W * 0.24, (Number(piece?.w) || 0) * 5));
  const h = Math.min(H, w * 0.4);
  let x;
  let y;
  if (piece && Number.isFinite(piece.x) && Number.isFinite(piece.y)) {
    x = piece.x + (piece.w || 0) / 2 - w / 2;
    y = piece.y + (piece.h || 0) / 2 - h / 2;
  } else {
    x = W - w;
    y = H - h;
  }
  x = Math.max(0, Math.min(W - w, x));
  y = Math.max(0, Math.min(H - h, y));
  return { x, y, w, h };
}
