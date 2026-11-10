// Edit measurement (Nightly, 'measure-edit'): name, depth and caption change
// after drawing; the caption shows the name in front, or nothing when off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildMeasureLabel,
  editMeasureData,
  measureCaption,
  measureName,
  scaleFromPreset,
  stampMeasure,
} from '../src/utils/measure/measureScale.js';
import { markupRows } from '../src/markupList/markupList.js';
import { menuIconFor } from '../src/utils/menuItems.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const QUARTER = scaleFromPreset('1/4');
const ROOM = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 90 }, { x: 0, y: 90 }];
const volume = (extra = {}) => {
  const obj = stampMeasure({ type: 'polygon', points: ROOM, data: { id: 'v1' } }, 'volume', QUARTER, { depth: 8 });
  return { ...obj, data: { ...obj.data, measure: { ...obj.data.measure, ...extra } } };
};

test('editMeasureData sets a name, a depth and caption off, and keeps kind and scale', () => {
  const m = volume().data.measure;
  const next = editMeasureData(m, { name: '  Room   101 ', depth: '10', caption: false });
  assert.deepEqual(next, { ...m, label: 'Room 101', depth: 10, caption: false });
  // Clearing the name and turning the caption back on drops both keys.
  const back = editMeasureData(next, { name: '', caption: true });
  assert.equal('label' in back, false);
  assert.equal('caption' in back, false);
  // A bad depth keeps the old one; a length has no depth to change.
  assert.equal(editMeasureData(m, { depth: 'x' }).depth, 8);
  assert.equal('depth' in editMeasureData({ kind: 'length' }, { depth: 5 }), false);
  assert.equal(editMeasureData(m, { name: 'x'.repeat(80) }).label.length, 60);
});

test('measureCaption puts the name in front, and hides a turned-off caption', () => {
  const plain = volume();
  const label = buildMeasureLabel(plain, QUARTER);
  assert.equal(measureCaption(plain, label), label);
  const named = volume({ label: 'Room 101' });
  assert.equal(measureCaption(named, buildMeasureLabel(named, QUARTER)).text, `Room 101 · ${label.text}`);
  assert.equal(measureName(named), 'Room 101');
  assert.equal(measureCaption(volume({ caption: false }), label), null);
  // A new depth changes the value the caption reads.
  const deeper = volume({ depth: 10 });
  assert.ok(Math.abs(buildMeasureLabel(deeper, QUARTER).value / label.value - 10 / 8) < 1e-9);
});

test('the markup list shows a measurement by its name', () => {
  const rows = markupRows({ annotationsByPage: { 1: { objects: [volume({ label: 'Room 101' })] } } });
  assert.equal(rows[0].text, 'Room 101');
  assert.equal(rows[0].typeName, 'Volume');
});

test('measure-edit is a beta flag with a migration row; the menu and the page layer use it', () => {
  assert.equal(FEATURE_FLAGS['measure-edit'].stage, 'beta');
  assert.match(readFileSync(new URL('../supabase/migrations/20261110141000_measure_edit_flag.sql', import.meta.url), 'utf8'), /\('measure-edit', 'off'/);
  assert.equal(menuIconFor('Edit measurement…'), 'measureScale');
  const menu = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(menu, /item\('Edit measurement…', 'editMeasure'/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /isFeatureOn\('measure-edit'\)/);
  assert.match(viewer, /editMeasure: measureEditEnabled \? openMeasureEdit : null/);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.equal((layer.match(/measureCaption\((obj|renderObj), buildMeasureLabel/g) || []).length, 2);
});
