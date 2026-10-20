// Custom builds library, step 1: Excel export formats as data ("export kits").
// The default kit must describe today's export exactly; PDFViewer does not use
// it yet, so this pins the two together before the switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerExportKit, listExportKits, getExportKit, validateExportKit,
  DEFAULT_EXPORT_KIT_ID, EXPORT_ENGINE_VERSION,
} from '../src/services/exportFormats/registry.js';
import { buildSheetLayout, buildSheetRow } from '../src/services/exportFormats/sheetLayout.js';

// Copy of the inline logic in PDFViewer.jsx handleExportSurveyToExcel.
function inlineLayout(checklistItems) {
  const headerRow = ['Row ID', 'Changed By', 'Changed Date', 'Item'];
  checklistItems.forEach((c) => headerRow.push(c.text || ''));
  headerRow.push('Entity');
  headerRow.push('Notes');
  const columnMapping = { A: 'row_id', B: 'changed_by', C: 'changed_date', D: 'name' };
  checklistItems.forEach((c, idx) => { columnMapping[String.fromCharCode(69 + idx)] = `checklist_${c.id}`; });
  const entityColIdx = 4 + checklistItems.length;
  columnMapping[String.fromCharCode(65 + entityColIdx)] = 'entity_name';
  columnMapping[String.fromCharCode(65 + entityColIdx + 1)] = 'notes';
  return { headerRow, columnMapping };
}

test('the default kit is registered and valid', () => {
  const kit = getExportKit(DEFAULT_EXPORT_KIT_ID);
  assert.ok(kit);
  assert.deepEqual(validateExportKit(kit), []);
  assert.ok(listExportKits().some((k) => k.id === DEFAULT_EXPORT_KIT_ID));
});

test('default kit layout matches the current inline export', () => {
  const kit = getExportKit(DEFAULT_EXPORT_KIT_ID);
  for (const items of [
    [],
    [{ id: 'c1', text: 'Door closes' }],
    [{ id: 1, text: 'A' }, { id: 2, text: '' }, { id: 3 }, { id: 'x', text: 'Lock works' }],
  ]) {
    const { headerRow, columnMapping, colOf, firstChecklistCol, lastChecklistCol } = buildSheetLayout(kit, items);
    assert.deepEqual({ headerRow, columnMapping }, inlineLayout(items));
    // Old hard-coded positions: Item 4, checklist 5.., Entity second to last, Notes last.
    const n = headerRow.length;
    assert.deepEqual(colOf, { row_id: 1, changed_by: 2, changed_date: 3, name: 4, entity_name: n - 1, notes: n });
    assert.equal(firstChecklistCol, 5);
    assert.equal(lastChecklistCol, n - 2);
    // Old inline row order.
    const answers = Object.fromEntries(items.map((c, i) => [c.id, i % 2 ? 'N' : 'Y']));
    const cells = { row_id: 'tok', changed_by: 'IC', changed_date: '10/20/2026', name: 'D1', entity_name: 'E', notes: 'n' };
    assert.deepEqual(buildSheetRow(kit, items, cells, answers),
      ['tok', 'IC', '10/20/2026', 'D1', ...items.map((c) => answers[c.id]), 'E', 'n']);
  }
});

test('invalid kits are refused', () => {
  const base = getExportKit(DEFAULT_EXPORT_KIT_ID);
  assert.ok(validateExportKit({ ...base, columns: base.columns.filter((c) => c.field !== 'notes') }).some((e) => e.includes('missing "notes"')));
  assert.ok(validateExportKit({ ...base, columns: [...base.columns].reverse() }).some((e) => e.includes('must start with')));
  assert.throws(() => registerExportKit({ id: 'Bad Id', kind: 'exportKit', version: '1', minEngine: 1, columns: [] }));
  assert.ok(validateExportKit({ id: 'a', kind: 'exportKit', version: '1.0.0', minEngine: 1, columns: [{ field: 'rm -rf' , header: 'x' }] }).length);
  assert.ok(validateExportKit({ id: 'a', kind: 'exportKit', version: '1.0.0', minEngine: 1, columns: [{ field: 'notes', header: 'N' }, { field: 'notes', header: 'N' }] }).length);
});

test('a tweaked kit registers, reorders columns, and unregisters', () => {
  const off = registerExportKit({
    id: 'tweak-test', kind: 'exportKit', version: '1.0.0', minEngine: 1, extends: 'default-survey@1.0.0',
    columns: [
      { field: 'row_id', header: 'Row ID' }, { field: 'changed_by', header: 'By' }, { field: 'changed_date', header: 'Date' },
      { field: 'notes', header: 'Comments' }, { field: 'checklist' }, { field: 'entity_name', header: 'Gateway' }, { field: 'name', header: 'Door' },
    ],
  });
  const kit = getExportKit('tweak-test');
  const { headerRow, columnMapping, colOf, firstChecklistCol, lastChecklistCol } = buildSheetLayout(kit, [{ id: 'k', text: 'In range' }]);
  assert.deepEqual(headerRow, ['Row ID', 'By', 'Date', 'Comments', 'In range', 'Gateway', 'Door']);
  assert.deepEqual(columnMapping, { A: 'row_id', B: 'changed_by', C: 'changed_date', D: 'notes', E: 'checklist_k', F: 'entity_name', G: 'name' });
  assert.deepEqual([colOf.notes, firstChecklistCol, lastChecklistCol, colOf.entity_name, colOf.name], [4, 5, 5, 6, 7]);
  assert.deepEqual(buildSheetRow(kit, [{ id: 'k' }], { row_id: 'r', changed_by: 'b', changed_date: 'd', name: 'D1', entity_name: 'G1', notes: 'x' }, { k: 'Y' }),
    ['r', 'b', 'd', 'x', 'Y', 'G1', 'D1']);
  off();
  assert.equal(getExportKit('tweak-test'), null);
});

test('kits needing a newer engine are hidden from this build', () => {
  const off = registerExportKit({
    id: 'future-kit', kind: 'exportKit', version: '1.0.0', minEngine: EXPORT_ENGINE_VERSION + 1,
    columns: [
      { field: 'row_id', header: 'Row ID' }, { field: 'changed_by', header: 'By' }, { field: 'changed_date', header: 'Date' },
      { field: 'name', header: 'Item' }, { field: 'checklist' }, { field: 'entity_name', header: 'E' }, { field: 'notes', header: 'N' },
    ],
  });
  assert.equal(getExportKit('future-kit'), null);
  assert.ok(!listExportKits().some((k) => k.id === 'future-kit'));
  off();
});

test('the Survey Excel export takes its layout from the default kit', async () => {
  const { readFileSync } = await import('node:fs');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /buildSheetLayout\(exportKit, checklistItems\)/);
  assert.match(viewer, /buildSheetRow\(exportKit, checklistItems,/);
  // Styling must not assume Entity is second to last any more.
  assert.doesNotMatch(viewer, /const entityColIndex = headerRow\.length - 1/);
  assert.doesNotMatch(viewer, /const headerRow = \['Row ID', 'Changed By', 'Changed Date', 'Item'\]/);
});

test('wireless-lock schedule kit: door, gateway, then the door checklist', () => {
  const kit = getExportKit('wireless-lock-schedule');
  assert.ok(kit);
  assert.equal(kit.extends, 'default-survey@1.0.0');
  const { headerRow, columnMapping } = buildSheetLayout(kit, [{ id: 'lt', text: 'Lock type' }, { id: 'ir', text: 'Gateway in range' }]);
  assert.deepEqual(headerRow, ['Row ID', 'Changed By', 'Changed Date', 'Door', 'Gateway', 'Lock type', 'Gateway in range', 'Notes']);
  // Sync identity columns stay first, as in the default kit.
  assert.deepEqual([columnMapping.A, columnMapping.B, columnMapping.C], ['row_id', 'changed_by', 'changed_date']);
});
