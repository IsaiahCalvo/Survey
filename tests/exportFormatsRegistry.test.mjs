// Custom builds library, step 1: Excel export formats as data ("export kits").
// The default kit must describe today's export exactly; PDFViewer does not use
// it yet, so this pins the two together before the switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerExportKit, listExportKits, getExportKit, validateExportKit,
  DEFAULT_EXPORT_KIT_ID, EXPORT_ENGINE_VERSION,
} from '../src/services/exportFormats/registry.js';
import { buildSheetLayout } from '../src/services/exportFormats/sheetLayout.js';

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
    assert.deepEqual(buildSheetLayout(kit, items), inlineLayout(items));
  }
});

test('invalid kits are refused', () => {
  assert.throws(() => registerExportKit({ id: 'Bad Id', kind: 'exportKit', version: '1', minEngine: 1, columns: [] }));
  assert.ok(validateExportKit({ id: 'a', kind: 'exportKit', version: '1.0.0', minEngine: 1, columns: [{ field: 'rm -rf' , header: 'x' }] }).length);
  assert.ok(validateExportKit({ id: 'a', kind: 'exportKit', version: '1.0.0', minEngine: 1, columns: [{ field: 'notes', header: 'N' }, { field: 'notes', header: 'N' }] }).length);
});

test('a tweaked kit registers, reorders columns, and unregisters', () => {
  const off = registerExportKit({
    id: 'tweak-test', kind: 'exportKit', version: '1.0.0', minEngine: 1, extends: 'default-survey@1.0.0',
    columns: [{ field: 'name', header: 'Door' }, { field: 'checklist' }, { field: 'notes', header: 'Comments' }],
  });
  const { headerRow, columnMapping } = buildSheetLayout(getExportKit('tweak-test'), [{ id: 'k', text: 'Gateway in range' }]);
  assert.deepEqual(headerRow, ['Door', 'Gateway in range', 'Comments']);
  assert.deepEqual(columnMapping, { A: 'name', B: 'checklist_k', C: 'notes' });
  off();
  assert.equal(getExportKit('tweak-test'), null);
});

test('kits needing a newer engine are hidden from this build', () => {
  const off = registerExportKit({
    id: 'future-kit', kind: 'exportKit', version: '1.0.0', minEngine: EXPORT_ENGINE_VERSION + 1,
    columns: [{ field: 'name', header: 'Item' }],
  });
  assert.equal(getExportKit('future-kit'), null);
  assert.ok(!listExportKits().some((k) => k.id === 'future-kit'));
  off();
});

test('the Survey Excel export takes its layout from the default kit', async () => {
  const { readFileSync } = await import('node:fs');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /buildSheetLayout\(getExportKit\(DEFAULT_EXPORT_KIT_ID\), checklistItems\)/);
  assert.doesNotMatch(viewer, /const headerRow = \['Row ID', 'Changed By', 'Changed Date', 'Item'\]/);
});
