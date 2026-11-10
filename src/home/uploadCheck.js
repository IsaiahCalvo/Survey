// Upload check (Nightly, flag 'upload-check'; Drawboard Projects round 2).
//
// Drawboard stops each upload at "Review & Publish": every file shows the
// number, name and revision it read, to fix before anyone sees it. Survey
// does the same in one small step after the file pick: the name, sheet
// number and revision the title block (or file name) gave, all editable,
// then "Upload". Pure: no React, no Supabase, so node tests import it.

import { displaySheetNumber, normalizeSheetNumber } from '../utils/titleBlock.js';

export const UPLOAD_NAME_MAX = 200;
export const SHEET_NUMBER_MAX = 40;
export const REVISION_MAX = 12;

const stripPdf = (name) => String(name || '').replace(/\.pdf$/i, '');

/** One row per picked file, before the title blocks are read. */
export function uploadCheckRows(files) {
  return (files || []).map((file, index) => ({
    key: `${index}:${file?.name || ''}`,
    fileName: file?.name || '',
    name: stripPdf(file?.name).trim(),
    sheet: '',
    revision: '',
    reading: true,
    source: null,
  }));
}

/** Fill a row from readUploadSheet's answer, keeping anything already typed. */
export function withSheetReading(row, reading) {
  if (!row) return row;
  return {
    ...row,
    reading: false,
    sheet: row.sheet || reading?.sheetLabel || (reading?.sheetNumber ? displaySheetNumber(reading.sheetNumber) : ''),
    revision: row.revision || (reading?.revision ? String(reading.revision) : ''),
    source: reading?.source || null,
  };
}

/** The file name a row uploads under: trimmed, no slashes, ".pdf" on the end. */
export function uploadFileName(row) {
  const base = stripPdf(String(row?.name || '').replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim())
    .slice(0, UPLOAD_NAME_MAX - 4)
    .trim();
  return base ? `${base}.pdf` : '';
}

/**
 * The sheet a row saves: { sheetNumber, sheetLabel, revision }, sheetNumber
 * null when the box is empty (the person checked: there is none). "a 101"
 * saves as A101 (shown A-101); a code the strict reader does not know
 * ("SEC-A01") is kept upper-case without spaces.
 */
export function uploadSheet(row) {
  const raw = String(row?.sheet || '').trim();
  const revision = String(row?.revision || '').trim().slice(0, REVISION_MAX) || null;
  // Upload pressed before the title block was read, nothing typed: give no
  // answer, so the upload reads it itself (the same-sheet offer still runs).
  if (!raw && !revision && row?.reading) return null;
  if (!raw) return { sheetNumber: null, sheetLabel: null, revision };
  const strict = normalizeSheetNumber(raw);
  const sheetNumber = (strict || raw.toUpperCase().replace(/\s+/g, '')).slice(0, SHEET_NUMBER_MAX);
  return { sheetNumber, sheetLabel: strict ? displaySheetNumber(strict) : sheetNumber, revision };
}

/** Problems that stop "Upload": { [key]: 'message' }. Empty when all is fine. */
export function uploadCheckProblems(rows) {
  const problems = {};
  const seen = new Map();
  for (const row of rows || []) {
    const name = uploadFileName(row);
    if (!name) { problems[row.key] = 'Give it a name.'; continue; }
    const lower = name.toLowerCase();
    if (seen.has(lower)) problems[row.key] = 'Two files have this name.';
    else seen.set(lower, row.key);
  }
  return problems;
}

/** A File under the row's name (the same bytes), or the original when unchanged. */
export function renamedFile(file, row) {
  const name = uploadFileName(row);
  if (!file || !name || name === file.name) return file;
  const next = new File([file], name, { type: file.type || 'application/pdf', lastModified: file.lastModified });
  if (file.user_id) next.user_id = file.user_id;
  return next;
}
