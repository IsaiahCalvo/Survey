// Sheet register (Nightly flag sheet-register, Drawboard Projects parity
// item 9): sheet number, revision and discipline on Home, discipline and
// open-items filters, sheet number sort, Edit details and the list CSV.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DISCIPLINES, EMPTY_REGISTER_FILTER, checkSheetDetails, compareSheetNumbers, csvCell, disciplineCounts,
  disciplineFromNumber, matchesRegisterSearch, passesRegisterFilter, registerCsv, registerCsvName,
  registerFilterIsEmpty, sheetInfo, sortRegisterRows,
} from '../src/sheets/sheetRegister.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const sql = readFileSync(new URL('../supabase/migrations/20261110185000_sheet_register.sql', import.meta.url), 'utf8');

test('the flag is a Nightly beta flag with its row', () => {
  assert.equal(FEATURE_FLAGS['sheet-register']?.stage, 'beta');
  assert.match(sql, /'sheet-register', 'off'/);
});

test('writes go through functions that check edit access', () => {
  for (const fn of ['set_document_discipline', 'set_document_sheet_details']) {
    assert.match(sql, new RegExp(`FUNCTION public\\.${fn}[\\s\\S]*?user_can_access_document\\(p_document_id, 'editor'\\)`));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
  }
  assert.match(sql, /list_sheet_register[\s\S]*user_can_access_document\(d\.id, 'viewer'\)/);
  assert.match(sql, /project_item_member\(i\.project_id, v_uid\)/);
});

test('discipline comes from the sheet number letters', () => {
  assert.equal(disciplineFromNumber('A-101'), 'Architectural');
  assert.equal(disciplineFromNumber('a101'), 'Architectural');
  assert.equal(disciplineFromNumber('S 201'), 'Structural');
  assert.equal(disciplineFromNumber('M-2.01'), 'Mechanical');
  assert.equal(disciplineFromNumber('FP-101'), 'Fire Protection');
  assert.equal(disciplineFromNumber('E001'), 'Electrical');
  assert.equal(disciplineFromNumber('101'), '');
  assert.equal(disciplineFromNumber(''), '');
  assert.equal(disciplineFromNumber('Kitchen'), '');
  assert.ok(DISCIPLINES.includes('Architectural'));
});

test('sheet info: saved number first, then the file name; a pick beats the number', () => {
  const doc = { name: 'A-101 Floor plan rev B.pdf', sheet_number: null, sheet_revision: null };
  assert.deepEqual(sheetInfo(doc), { number: 'A-101', revision: 'B', discipline: 'Architectural', disciplinePicked: false });
  assert.equal(sheetInfo({ name: 'x.pdf', sheet_number: 'M201', sheet_revision: '3' }).number, 'M-201');
  assert.equal(sheetInfo({ name: 'x.pdf', sheet_number: 'SEC-A01' }).number, 'SEC-A01');
  assert.deepEqual(sheetInfo(doc, { discipline: 'Interiors' }).discipline, 'Interiors');
  assert.equal(sheetInfo(doc, { discipline: 'Interiors' }).disciplinePicked, true);
  // A local Edit details wins, even when it clears the number.
  const cleared = sheetInfo(doc, null, { sheetNumber: null, revision: null });
  assert.equal(cleared.number, '');
  assert.equal(cleared.revision, '');
  assert.equal(cleared.discipline, '');
  assert.equal(sheetInfo(doc, null, { sheetNumber: 'E-5', revision: 'C' }).discipline, 'Electrical');
  assert.equal(sheetInfo({ name: 'Notes.pdf' }).number, '');
});

test('search finds a sheet by number written any way, or by discipline', () => {
  const info = sheetInfo({ name: 'Plan.pdf', sheet_number: 'A101' });
  assert.ok(matchesRegisterSearch(info, 'a101'));
  assert.ok(matchesRegisterSearch(info, 'A-101'));
  assert.ok(matchesRegisterSearch(info, 'archi'));
  assert.ok(!matchesRegisterSearch(info, 'M-1'));
  assert.ok(matchesRegisterSearch(info, ''));
  assert.ok(!matchesRegisterSearch(null, 'a'));
});

test('filters: discipline, no discipline, with and without open items', () => {
  const arch = sheetInfo({ name: 'A-101.pdf' });
  const none = sheetInfo({ name: 'Notes.pdf' });
  assert.ok(registerFilterIsEmpty(EMPTY_REGISTER_FILTER));
  assert.ok(passesRegisterFilter(arch, 0, { discipline: 'Architectural', openItems: null }));
  assert.ok(!passesRegisterFilter(none, 0, { discipline: 'Architectural', openItems: null }));
  assert.ok(passesRegisterFilter(none, 0, { discipline: '', openItems: null }));
  assert.ok(!registerFilterIsEmpty({ discipline: '', openItems: null }));
  assert.ok(passesRegisterFilter(arch, 2, { discipline: null, openItems: 'with' }));
  assert.ok(!passesRegisterFilter(arch, 0, { discipline: null, openItems: 'with' }));
  assert.ok(passesRegisterFilter(arch, 0, { discipline: null, openItems: 'without' }));
  assert.ok(!passesRegisterFilter(arch, 1, { discipline: null, openItems: 'without' }));
  assert.deepEqual(disciplineCounts([arch, arch, none, sheetInfo({ name: 'S-1.pdf', sheet_number: 'S101' })]), [
    { discipline: 'Architectural', count: 2 },
    { discipline: 'Structural', count: 1 },
    { discipline: '', count: 1 },
  ]);
});

test('sheet numbers sort as numbers; unnumbered sheets go last both ways', () => {
  const rows = [
    { id: 1, name: 'z', n: 'A-10' }, { id: 2, name: 'y', n: '' }, { id: 3, name: 'x', n: 'A-2' }, { id: 4, name: 'w', n: 'S-1' },
  ];
  const infoOf = (r) => ({ number: r.n });
  assert.deepEqual(sortRegisterRows(rows, 'sheet', 'asc', { infoOf }).map((r) => r.id), [3, 1, 4, 2]);
  assert.deepEqual(sortRegisterRows(rows, 'sheet', 'desc', { infoOf }).map((r) => r.id), [4, 1, 3, 2]);
  assert.equal(compareSheetNumbers('A-2', 'A-10') < 0, true);
});

test('status sorts in review order; no status last', () => {
  const rows = [{ id: 1, name: 'a', r: Infinity }, { id: 2, name: 'b', r: 4 }, { id: 3, name: 'c', r: 0 }];
  const statusRank = (r) => r.r;
  assert.deepEqual(sortRegisterRows(rows, 'status', 'asc', { statusRank }).map((r) => r.id), [3, 2, 1]);
  assert.deepEqual(sortRegisterRows(rows, 'status', 'desc', { statusRank }).map((r) => r.id), [2, 3, 1]);
});

test('Edit details checks its fields', () => {
  assert.deepEqual(checkSheetDetails({ number: ' A-1 ', name: ' Plan ', revision: 'B', discipline: '' }).value, { number: 'A-1', name: 'Plan', revision: 'B', discipline: '' });
  assert.match(checkSheetDetails({ name: '  ' }).error, /name/);
  assert.match(checkSheetDetails({ name: 'x', number: 'x'.repeat(41) }).error, /sheet number/);
  assert.match(checkSheetDetails({ name: 'x', revision: 'x'.repeat(13) }).error, /revision/);
});

test('the CSV quotes, never runs formulas, and uses CRLF', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(3), '3');
  const text = registerCsv([{
    number: 'A-101', name: 'Plan, level 1', revision: 'B', discipline: 'Architectural', status: 'Approved', assignee: 'Eddie',
    markups: 2, openItems: 1, tags: ['site', 'ground'], project: 'Job', uploadedMs: Date.UTC(2026, 10, 12, 15), uploadedBy: 'Olive',
    editedMs: 0, version: 2,
  }]);
  const lines = text.split('\r\n');
  assert.equal(lines[0], 'Sheet number,Name,Revision,Discipline,Status,Assignee,Markups,Open items,Tags,Project,Uploaded,Uploaded by,Last edited,Version');
  assert.match(lines[1], /^A-101,"Plan, level 1",B,Architectural,Approved,Eddie,2,1,site; ground,Job,2026-11-1\d,Olive,,2$/);
  assert.equal(lines[2], '');
  assert.match(registerCsvName(Date.UTC(2026, 10, 12, 15)), /^Drawing list 2026-11-1\d\.csv$/);
});
