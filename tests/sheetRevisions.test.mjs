// Sheet revisions (Nightly flag 'sheet-revisions', Drawboard Projects trial
// audit 2026-11-09): Drawboard reads each uploaded sheet's title block and
// files a sheet number it already has as a new revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  displaySheetNumber,
  normalizeSheetNumber,
  pickSameSheetDocument,
  readSheetFromFileName,
  readTitleBlock,
} from '../src/utils/titleBlock.js';
import { readUploadSheet } from '../src/home/readUploadTitleBlock.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');
const PAGE = { width: 1224, height: 792 };
const piece = (str, x, y, h = 8, w = str.length * h * 0.55) => ({ str, x, y, w, h });

test('sheet numbers read the same however they are spaced', () => {
  assert.equal(normalizeSheetNumber('A-101'), 'A101');
  assert.equal(normalizeSheetNumber('a 101'), 'A101');
  assert.equal(normalizeSheetNumber('M-2.01'), 'M2.01');
  assert.equal(normalizeSheetNumber('FP-101A'), 'FP101A');
  assert.equal(normalizeSheetNumber('NO 5'), null, 'a short word before a number is not a sheet');
  assert.equal(normalizeSheetNumber('Floor plan'), null);
  assert.equal(displaySheetNumber('A101'), 'A-101');
});

test('file names give a sheet number and revision, but not a version tag', () => {
  assert.deepEqual(readSheetFromFileName('A-101 Floor Plan rev B.pdf'), { sheetNumber: 'A101', revision: 'B' });
  assert.deepEqual(readSheetFromFileName('Plans_M2.01_R3.pdf'), { sheetNumber: 'M2.01', revision: '3' });
  assert.deepEqual(readSheetFromFileName('plan_v2.pdf'), { sheetNumber: null, revision: null });
  assert.deepEqual(readSheetFromFileName('Site survey.pdf'), { sheetNumber: null, revision: null });
});

test('a labelled sheet number wins, in any naming style; the highest revision counts', () => {
  const items = [
    piece('NOTES', 100, 100, 10),
    piece('SEE A-501', 200, 300, 8),
    piece('SHEET NO.', 1100, 700, 6),
    piece('SEC-A01', 1100, 710, 12),
    piece('REV', 1000, 700, 6),
    piece('1', 1000, 712, 6),
    piece('2', 1000, 722, 6),
  ];
  assert.deepEqual(readTitleBlock(items, PAGE), { sheetNumber: 'SECA01', sheetLabel: 'SEC-A01', revision: '2' });
  assert.equal(readTitleBlock([piece('Sheet No: E-001', 1100, 740)], PAGE).sheetNumber, 'E001');
  assert.equal(readTitleBlock([piece('Revision 1', 1100, 600), piece('Revision 2', 1110, 600), piece('A-101', 1150, 740, 20)], PAGE).revision, '2');
});

test('no label: only a big lone number in the corner counts, never a field of tags', () => {
  const big = [piece('Plan', 300, 200, 8), piece('Notes', 300, 300, 8), piece('Hall', 400, 300, 8), piece('A-101', 1100, 720, 20)];
  assert.equal(readTitleBlock(big, PAGE).sheetNumber, 'A101');
  const tags = [];
  for (let i = 0; i < 30; i += 1) tags.push(piece(`P${i + 10}`, 760 + (i % 6) * 60, 500 + Math.floor(i / 6) * 40, 4));
  assert.equal(readTitleBlock(tags, PAGE).sheetNumber, null);
  const small = [piece('Plan', 300, 200, 8), piece('Notes', 300, 300, 8), piece('A-101', 1100, 720, 8)];
  assert.equal(readTitleBlock(small, PAGE).sheetNumber, null, 'a normal-size code with no label is not trusted');
  assert.deepEqual(readTitleBlock([], PAGE), { sheetNumber: null, sheetLabel: null, revision: null });
});

test('the newest open document of the same sheet is offered, never the same bytes or name', () => {
  const docs = [
    { id: 'old', name: 'A-101 Floor Plan.pdf', created_at: '2026-11-01', content_sha256: 'a' },
    { id: 'saved', name: 'Level 1.pdf', sheet_number: 'A101', sheet_revision: 'B', created_at: '2026-11-05', content_sha256: 'b' },
    { id: 'other', name: 'A-102 Ceiling.pdf', created_at: '2026-11-06', content_sha256: 'c' },
    { id: 'gone', name: 'A-101 old.pdf', superseded_by: 'saved', created_at: '2026-11-07', content_sha256: 'd' },
  ];
  const hit = pickSameSheetDocument({ sheetNumber: 'A101', sha: 'z', name: 'A-101 rev C.pdf' }, docs);
  assert.equal(hit.doc.id, 'saved');
  assert.equal(hit.revision, 'B');
  assert.equal(pickSameSheetDocument({ sheetNumber: 'A101', sha: 'b', name: 'x.pdf' }, docs).doc.id, 'old');
  assert.equal(pickSameSheetDocument({ sheetNumber: 'A999', sha: 'z', name: 'x.pdf' }, docs), null);
  assert.equal(pickSameSheetDocument({ sheetNumber: null }, docs), null);
});

async function drawingSheet({ rotated = false, sheet, rev }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([1224, 792]);
  page.drawText('FIRST FLOOR PLAN', { x: 80, y: 720, size: 14, font });
  for (let i = 0; i < 6; i += 1) page.drawText(`D-${100 + i}`, { x: 200 + i * 70, y: 400, size: 6, font });
  if (rotated) {
    // A title strip up the right edge, read sideways.
    page.drawText('Drawing Number', { x: 1180, y: 60, size: 6, font, rotate: degrees(90) });
    page.drawText(sheet, { x: 1192, y: 60, size: 8, font, rotate: degrees(90) });
    page.drawText('Revision 1', { x: 1160, y: 300, size: 6, font, rotate: degrees(90) });
    page.drawText(`Revision ${rev}`, { x: 1170, y: 300, size: 6, font, rotate: degrees(90) });
  } else {
    page.drawText('SHEET NO.', { x: 1080, y: 80, size: 7, font });
    page.drawText(sheet, { x: 1080, y: 56, size: 18, font });
    page.drawText('REV', { x: 1170, y: 80, size: 7, font });
    page.drawText(rev, { x: 1170, y: 60, size: 10, font });
  }
  return new Uint8Array(await pdf.save());
}

test('a real PDF title block reads, upright or sideways, and the file name fills gaps', async () => {
  const loadPdfjs = async () => pdfjs;
  const upright = await readUploadSheet({ bytes: await drawingSheet({ sheet: 'A-101', rev: 'B' }), fileName: 'scan 7.pdf', loadPdfjs });
  assert.deepEqual(upright, { sheetNumber: 'A101', sheetLabel: 'A-101', revision: 'B', source: 'title-block' });
  const sideways = await readUploadSheet({ bytes: await drawingSheet({ rotated: true, sheet: 'SEC-H10', rev: '2' }), fileName: 'x.pdf', loadPdfjs });
  assert.equal(sideways.sheetNumber, 'SECH10');
  assert.equal(sideways.revision, '2');
  const named = await readUploadSheet({ bytes: new Uint8Array([1, 2, 3]), fileName: 'E-201 Power rev 4.pdf', loadPdfjs });
  assert.deepEqual(named, { sheetNumber: 'E201', sheetLabel: 'E-201', revision: '4', source: 'file-name' });
});

test('the flag is beta and seeded, the columns exist, and the upload asks in sheet mode', () => {
  assert.equal(FEATURE_FLAGS['sheet-revisions'].stage, 'beta');
  const migration = readFileSync(new URL('../supabase/migrations/20261109203000_sheet_revisions.sql', import.meta.url), 'utf8');
  assert.match(migration, /add column if not exists sheet_number text/);
  assert.match(migration, /add column if not exists sheet_revision text/);
  assert.match(migration, /'sheet-revisions', 'off'/);
  const dash = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(dash, /isFeatureOn\('sheet-revisions'\)\) return confirmSameSheet/);
  assert.match(dash, /askDuplicateUpload\('sheet'/);
  assert.equal((dash.match(/saveSheetReading\(newDocId, duplicateGate\.sheet\)/g) || []).length, 2, 'both upload paths save the reading');
  assert.match(dash, /import\('\.\/home\/readUploadTitleBlock\.js'\)/, 'the reader loads only when the flag is on');
  const modal = readFileSync(new URL('../src/components/DuplicateUploadModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /New revision of sheet/);
  assert.match(modal, /'keep-both'/);
});
