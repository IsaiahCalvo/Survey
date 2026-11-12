// Upload review (Nightly flag upload-review, Drawboard Projects parity
// UP-10..23): rows, split per page, bulk edits, problems and warnings, the
// Show filter, the result handed to the upload and the title-block crop box.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canSplit, joinRows, patchRows, removeRows, reviewProblems, reviewResult, reviewRows, rowDiscipline, rowShown,
  showCounts, splitRows, titleBlockCropBox, withReviewReading,
} from '../src/home/uploadReview.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const sql = readFileSync(new URL('../supabase/migrations/20261112130000_upload_review_flag.sql', import.meta.url), 'utf8');
const files = [{ name: 'A-101 Plan.pdf' }, { name: 'Set.pdf' }];

test('the flag is a Nightly beta flag with its row', () => {
  assert.equal(FEATURE_FLAGS['upload-review']?.stage, 'beta');
  assert.match(sql, /'upload-review', 'off'/);
});

test('rows start reading and fill from a reading without losing typed values', () => {
  const [a, b] = reviewRows(files);
  assert.equal(a.fileIndex, 0);
  assert.equal(b.name, 'Set');
  assert.equal(a.reading, true);
  const filled = withReviewReading({ ...a, revision: 'C' }, { sheetNumber: 'A101', sheetLabel: 'A-101', revision: 'B', source: 'title-block', pageCount: 1, crop: 'data:x' });
  assert.equal(filled.sheet, 'A-101');
  assert.equal(filled.revision, 'C');
  assert.equal(filled.crop, 'data:x');
  assert.equal(filled.pageCount, 1);
  assert.equal(filled.reading, false);
  assert.equal(rowDiscipline(filled), 'Architectural');
  assert.equal(rowDiscipline({ ...filled, discipline: 'Interiors' }), 'Interiors');
});

test('one document per page, and back', () => {
  let rows = reviewRows(files).map((r) => withReviewReading(r, { pageCount: r.fileIndex === 1 ? 3 : 1 }));
  assert.equal(canSplit(rows[0]), false);
  assert.equal(canSplit(rows[1]), true);
  rows = splitRows(rows, 1);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map((r) => [r.page, r.name, r.reading]), [[1, 'Set - p1', true], [2, 'Set - p2', true], [3, 'Set - p3', true]]);
  assert.equal(new Set(rows.map((r) => r.key)).size, 4);
  assert.equal(canSplit(rows[2]), false);
  rows = joinRows(rows, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].page, null);
  assert.equal(rows[1].name, 'Set');
});

test('bulk patch and remove touch only the picked rows', () => {
  const rows = reviewRows(files);
  const patched = patchRows(rows, [rows[1].key], { revision: 'D' });
  assert.equal(patched[0].revision, '');
  assert.equal(patched[1].revision, 'D');
  assert.deepEqual(removeRows(rows, [rows[0].key]).map((r) => r.fileIndex), [1]);
});

test('errors block, same sheet and revision warns (uploaded or twice here)', () => {
  const rows = [
    { key: 'a', fileIndex: 0, name: 'One', sheet: 'A-101', revision: 'B' },
    { key: 'b', fileIndex: 1, name: 'Two', sheet: 'a101', revision: 'c' },
    { key: 'c', fileIndex: 2, name: 'Three', sheet: 'A 101', revision: 'C' },
    { key: 'd', fileIndex: 3, name: '', sheet: 'M-1', revision: '1' },
  ];
  const problems = reviewProblems(rows, [{ sheet_number: 'A101', sheet_revision: 'B', name: 'old.pdf' }]);
  assert.deepEqual(Object.keys(problems.errors), ['d']);
  assert.match(problems.warnings.a, /already uploaded/);
  assert.equal(problems.warnings.b, undefined);
  assert.match(problems.warnings.c, /twice/);
  assert.equal(rowShown(rows[0], 'problems', problems), true);
  assert.equal(rowShown(rows[1], 'problems', problems), false);
  assert.deepEqual(showCounts(rows, problems), { all: 4, problems: 3, 'no-discipline': 0 });
  assert.equal(rowShown({ key: 'z', name: 'x', sheet: '', reading: false }, 'no-discipline', problems), true);
  assert.equal(rowShown({ key: 'z', name: 'x', sheet: '', reading: true }, 'no-discipline', problems), false);
});

test('the upload gets file, page, name and the sheet with its picked discipline', () => {
  const rows = [
    { key: 'a', fileIndex: 0, page: null, name: 'Plan', sheet: 'a 101', revision: 'B', discipline: '', reading: false },
    { key: 'b', fileIndex: 1, page: 2, name: 'Set - p2', sheet: '', revision: '', discipline: 'Civil', reading: false },
    { key: 'c', fileIndex: 1, page: 3, name: 'Set - p3', sheet: '', revision: '', discipline: '', reading: true },
  ];
  assert.deepEqual(reviewResult(rows), [
    { fileIndex: 0, page: null, fileName: 'Plan.pdf', sheet: { sheetNumber: 'A101', sheetLabel: 'A-101', revision: 'B', discipline: null } },
    { fileIndex: 1, page: 2, fileName: 'Set - p2.pdf', sheet: { sheetNumber: null, sheetLabel: null, revision: null, discipline: 'Civil' } },
    { fileIndex: 1, page: 3, fileName: 'Set - p3.pdf', sheet: null },
  ]);
});

test('the crop box sits around the sheet number, else in the bottom-right corner, inside the page', () => {
  const page = { width: 1000, height: 600 };
  assert.deepEqual(titleBlockCropBox(page), { x: 760, y: 504, w: 240, h: 96 });
  const box = titleBlockCropBox(page, { x: 900, y: 560, w: 40, h: 20 });
  assert.ok(box.x + box.w <= 1000 && box.y + box.h <= 600 && box.x >= 0 && box.y >= 0);
  assert.ok(box.x <= 900 && box.x + box.w >= 940);
  const centred = titleBlockCropBox(page, { x: 400, y: 300, w: 40, h: 20 });
  assert.equal(centred.x, 420 - 120);
  assert.equal(titleBlockCropBox({ width: 0, height: 0 }), null);
});
