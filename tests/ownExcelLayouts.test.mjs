// Your own Excel layout (Nightly beta 'own-excel-layouts', plan 2026-10-27):
// a sheet's columns matched by hand become an export kit on the account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { buildOwnKit, createOwnKitStore, ownKitCopyFor, ownKitId, readSheetHeaders, registerTemplateKits, templateOwnKitOf } from '../src/services/exportFormats/ownKits.js';
import { getExportKit, validateExportKit } from '../src/services/exportFormats/registry.js';
import { buildSheetLayout } from '../src/services/exportFormats/sheetLayout.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

async function sheetBytes(rows) {
  const book = new ExcelJS.Workbook();
  const ws = book.addWorksheet('Doors');
  rows.forEach((r) => ws.addRow(r));
  return book.xlsx.writeBuffer();
}

test('the headers come from the first row of names, past a title, blanks dropped', async () => {
  const bytes = await sheetBytes([['ACME DOOR SCHEDULE'], [], ['Door No.', null, 'Lock', { richText: [{ text: 'Rem' }, { text: 'arks' }] }, '  Status  ']]);
  assert.deepEqual(await readSheetHeaders(bytes), ['Door No.', 'Lock', 'Remarks', 'Status']);
  assert.deepEqual(await readSheetHeaders(await sheetBytes([['Door']])), ['Door']);
});

test('their columns, in their order, after the three the sync needs', () => {
  const kit = buildOwnKit({
    id: 'own-door-schedule',
    label: 'Door schedule',
    headers: ['Door No.', 'Lock', 'Remarks', 'Status', 'Inspector'],
    matches: ['name', 'checklist', 'notes', '', 'changed_by'],
  });
  assert.deepEqual(validateExportKit(kit), []);
  assert.deepEqual(kit.columns, [
    { field: 'row_id', header: 'Row ID' },
    { field: 'changed_by', header: 'Inspector' },
    { field: 'changed_date', header: 'Changed Date' },
    { field: 'name', header: 'Door No.' },
    { field: 'checklist' },
    { field: 'notes', header: 'Remarks' },
    { field: 'entity_name', header: 'Entity' },
  ]);
  const layout = buildSheetLayout(kit, [{ id: 'a', text: 'Frame' }, { id: 'b', text: 'Leaf' }]);
  assert.deepEqual(layout.headerRow, ['Row ID', 'Inspector', 'Changed Date', 'Door No.', 'Frame', 'Leaf', 'Remarks', 'Entity']);
});

test('nothing matched is refused; a field matched twice keeps the first', () => {
  assert.throws(() => buildOwnKit({ id: 'own-x', label: 'X', headers: ['A'], matches: [''] }), /Match at least one/);
  const kit = buildOwnKit({ id: 'own-x', label: 'X', headers: ['A', 'B'], matches: ['notes', 'notes'] });
  assert.equal(kit.columns.find((c) => c.field === 'notes').header, 'A');
});

test('ids never clash, and carry a random tail so two people\'s "Doors" differ', () => {
  const tails = ['ab12', 'ab12', 'cd34'];
  const next = () => tails.shift();
  assert.equal(ownKitId('Door Schedule (rev 2)', [], () => 'x1'), 'own-door-schedule-rev-2-x1');
  assert.equal(ownKitId('Doors', ['own-doors-ab12'], next), 'own-doors-cd34');
  assert.equal(ownKitId('!!!', [], () => 'z'), 'own-layout-z');
  assert.match(ownKitId('Doors'), /^own-doors-[a-z0-9]{1,5}$/);
});

test('a template carries its own layout to teammates, who export in it', () => {
  const kit = buildOwnKit({ id: 'own-shared-q1', label: 'Shared', headers: ['Door'], matches: ['name'] });
  const template = { id: 't', exportKitId: kit.id, ownExportKit: ownKitCopyFor(kit) };
  assert.equal(templateOwnKitOf(template).columns[3].header, 'Door');
  assert.equal(templateOwnKitOf({ ...template, exportKitId: 'wireless-lock-schedule' }), null, 'only own- ids');
  assert.equal(templateOwnKitOf({ ...template, ownExportKit: { label: 'Bad', columns: [] } }), null, 'only valid kits');
  assert.equal(ownKitCopyFor(getExportKit('default-survey')), null);
  const off = registerTemplateKits([template, { id: 'u' }]);
  assert.equal(getExportKit(kit.id).label, 'Shared');
  off();
  assert.equal(getExportKit(kit.id), null);
});

test('saving registers the layout so pickers and the export see it', async () => {
  const inserted = [];
  const client = { from: () => ({ insert: async (row) => { inserted.push(row); return { error: null }; } }) };
  const store = createOwnKitStore(client);
  const kit = buildOwnKit({ id: 'own-doors', label: 'Doors', headers: ['Door'], matches: ['name'] });
  assert.equal(await store.save(kit), 'own-doors');
  assert.equal(inserted[0].id, 'own-doors');
  assert.equal(inserted[0].definition.columns.length, 7);
  assert.equal(getExportKit('own-doors').label, 'Doors');
  store.unload();
  assert.equal(getExportKit('own-doors'), null);
});

test('flag is beta, and the table is the owner\'s alone', () => {
  assert.equal(FEATURE_FLAGS['own-excel-layouts'].stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261028011000_own_export_kits.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /for insert to authenticated\s+with check \(user_id = \(select auth\.uid\(\)\) and not public\.is_agent_session\(\)\)/);
  assert.match(sql, /'own-excel-layouts', 'off'/);
});
