import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  uploadCheckRows,
  withSheetReading,
  uploadFileName,
  uploadSheet,
  uploadCheckProblems,
  renamedFile,
} from '../src/home/uploadCheck.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const files = [{ name: 'A-101 Floor plan.pdf' }, { name: 'notes.PDF' }];

test('rows start from the file names, reading', () => {
  const rows = uploadCheckRows(files);
  assert.deepEqual(rows.map((r) => [r.name, r.reading]), [['A-101 Floor plan', true], ['notes', true]]);
  assert.notEqual(rows[0].key, rows[1].key);
});

test('a reading fills empty boxes and keeps typed ones', () => {
  const [row] = uploadCheckRows(files);
  const filled = withSheetReading(row, { sheetNumber: 'A101', sheetLabel: 'A-101', revision: '3', source: 'title-block' });
  assert.deepEqual([filled.sheet, filled.revision, filled.source, filled.reading], ['A-101', '3', 'title-block', false]);
  const typed = withSheetReading({ ...row, sheet: 'A-102' }, { sheetNumber: 'A101', revision: null, source: 'file-name' });
  assert.deepEqual([typed.sheet, typed.revision], ['A-102', '']);
  assert.equal(withSheetReading(row, null).reading, false);
});

test('upload names are tidy and end in .pdf', () => {
  assert.equal(uploadFileName({ name: '  Level 2 / east  ' }), 'Level 2 - east.pdf');
  assert.equal(uploadFileName({ name: 'plan.pdf' }), 'plan.pdf');
  assert.equal(uploadFileName({ name: '   ' }), '');
  assert.equal(uploadFileName({ name: 'x'.repeat(300) }).length, 200);
});

test('sheet numbers are kept the way the reader keeps them', () => {
  assert.deepEqual(uploadSheet({ sheet: 'a 101', revision: ' B ' }), { sheetNumber: 'A101', sheetLabel: 'A-101', revision: 'B' });
  assert.deepEqual(uploadSheet({ sheet: 'sec-a01', revision: '' }), { sheetNumber: 'SEC-A01', sheetLabel: 'SEC-A01', revision: null });
  assert.deepEqual(uploadSheet({ sheet: '', revision: '' }), { sheetNumber: null, sheetLabel: null, revision: null });
});

test('an empty name or two of the same name stop the upload', () => {
  const rows = uploadCheckRows([{ name: 'a.pdf' }, { name: 'b.pdf' }, { name: 'c.pdf' }]);
  assert.deepEqual(uploadCheckProblems(rows), {});
  rows[1] = { ...rows[1], name: 'A' };
  rows[2] = { ...rows[2], name: ' ' };
  const problems = uploadCheckProblems(rows);
  assert.equal(problems[rows[1].key], 'Two files have this name.');
  assert.equal(problems[rows[2].key], 'Give it a name.');
  assert.equal(problems[rows[0].key], undefined);
});

test('a renamed file keeps its bytes and owner', async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'old.pdf', { type: 'application/pdf' });
  file.user_id = 'u1';
  assert.equal(renamedFile(file, { name: 'old' }), file);
  const next = renamedFile(file, { name: 'New name' });
  assert.equal(next.name, 'New name.pdf');
  assert.equal(next.user_id, 'u1');
  assert.deepEqual([...new Uint8Array(await next.arrayBuffer())], [1, 2, 3]);
});

test('upload-check is a Nightly beta flag with a migration row', () => {
  assert.equal(FEATURE_FLAGS['upload-check'].stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261110132000_upload_check_flag.sql', import.meta.url), 'utf8');
  assert.match(sql, /'upload-check'/);
});

test('Upload pressed while the title block is still reading gives no sheet, so the upload reads it', () => {
  const [row] = uploadCheckRows([{ name: 'A-101.pdf' }]);
  assert.equal(row.reading, true);
  assert.equal(uploadSheet({ ...row, sheet: '', revision: '' }), null);
  // Anything typed while it reads still stands.
  assert.equal(uploadSheet({ ...row, sheet: 'a 101', revision: '' }).sheetNumber, 'A101');
  // Read and empty: the person checked, there is none.
  assert.deepEqual(uploadSheet({ ...row, reading: false, sheet: '', revision: '' }), { sheetNumber: null, sheetLabel: null, revision: null });
});
