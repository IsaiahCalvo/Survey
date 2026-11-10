// Markups panel (Nightly, 'markup-list'): the pure list, filters, totals, CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NO_AUTHOR,
  filterMarkupRows,
  markupCsv,
  markupCsvFileName,
  markupFacets,
  markupRows,
  markupTotals,
  measureQuantity,
} from '../src/markupList/markupList.js';
import { scaleFromPreset, stampMeasure } from '../src/utils/measure/measureScale.js';
import { addLayer } from '../src/utils/layers.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const QUARTER = scaleFromPreset('1/4'); // 18 pt per foot
const ROOM = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 90 }, { x: 0, y: 90 }]; // 10 ft x 5 ft
// A 180 pt line = 10 ft.
const lengthLine = (id, author) => stampMeasure({ type: 'line', left: 0, top: 0, width: 180, height: 0, x1: -90, y1: 0, x2: 90, y2: 0, stroke: '#ff0000', data: { id }, meta: { authorId: author } }, 'length', QUARTER);
const area = (id, author) => stampMeasure({ type: 'polygon', points: ROOM, data: { id }, meta: { authorId: author } }, 'area', QUARTER);

const { state: layers } = addLayer(null, { name: 'Electrical', id: 'layer-e' });
const DOC = {
  annotationsByPage: {
    2: { objects: [area('a1', 'u1'), { type: 'textbox', text: 'Check   valve size', data: { id: 't1' }, meta: { authorId: 'u2' }, layerId: 'layer-e' }] },
    1: { objects: [lengthLine('l1', 'u1'), lengthLine('l2', 'u2'), { type: 'rect', data: { id: 'r1' }, stroke: 'transparent', fill: '#00ff00' }, { type: 'space', data: { id: 's1' } }] },
  },
  surveyMarkers: { m1: { name: 'Door 4', pageNumber: 1, userId: 'u2', bounds: { x: 0, y: 0, width: 10, height: 10 } }, gone: { name: 'Old', pageNumber: 1, deletedAt: '2026-01-01' } },
  layerState: layers,
};
const names = { u1: 'Olive Owner', u2: 'Eddie Editor' };
const nameOf = (id) => names[id] || '';

test('one row per mark, page by page; spaces left out; Survey Markers kept; deleted ones gone', () => {
  const rows = markupRows(DOC);
  assert.deepEqual(rows.map((r) => [r.pageNumber, r.id, r.typeName]), [
    [1, 'l1', 'Length'], [1, 'l2', 'Length'], [1, 'r1', 'Rectangle'], [1, 'm1', 'Survey Marker'],
    [2, 'a1', 'Area'], [2, 't1', 'Text box'],
  ]);
  const text = rows.find((r) => r.id === 't1');
  assert.equal(text.text, 'Check valve size');
  assert.equal(text.layerName, 'Electrical');
  assert.equal(rows.find((r) => r.id === 'r1').authorId, NO_AUTHOR);
  assert.equal(rows.find((r) => r.id === 'r1').color, '#00ff00');
  assert.equal(rows.find((r) => r.id === 'm1').text, 'Door 4');
});

test('measurements carry their real quantity and unit', () => {
  const rows = markupRows(DOC);
  assert.deepEqual(rows.find((r) => r.id === 'l1').measure, { kind: 'length', name: 'Length', text: '10\' 0"', quantity: 10, unit: 'ft', dimension: 'length', scaled: true });
  assert.equal(rows.find((r) => r.id === 'a1').measure.quantity, 50);
  assert.equal(rows.find((r) => r.id === 'a1').measure.unit, 'sq ft');
  // No scale anywhere: paper inches, and it says so.
  const bare = { type: 'line', left: 0, top: 0, width: 144, height: 0, x1: -72, y1: 0, x2: 72, y2: 0, data: { measure: { kind: 'length' } } };
  assert.deepEqual(measureQuantity(bare), { kind: 'length', name: 'Length', text: '2 in (no scale)', quantity: 2, unit: 'in', dimension: 'length', scaled: false });
});

test('totals add like with like', () => {
  assert.deepEqual(markupTotals(markupRows(DOC)).map((t) => [t.name, t.quantity, t.unit, t.count]), [
    ['Length', 20, 'ft', 2],
    ['Area', 50, 'sq ft', 1],
  ]);
});

test('search and filters', () => {
  const rows = markupRows(DOC);
  const ids = (list) => list.map((r) => r.id);
  assert.deepEqual(ids(filterMarkupRows(rows, { query: 'valve' }, { nameOf })), ['t1']);
  assert.deepEqual(ids(filterMarkupRows(rows, { query: 'eddie' }, { nameOf })), ['l2', 'm1', 't1']);
  assert.deepEqual(ids(filterMarkupRows(rows, { query: 'p2' }, { nameOf })), ['a1', 't1']);
  assert.deepEqual(ids(filterMarkupRows(rows, { query: 'sq ft' }, { nameOf })), ['a1']);
  assert.deepEqual(ids(filterMarkupRows(rows, { query: 'no author' }, { nameOf })), ['r1']);
  assert.deepEqual(ids(filterMarkupRows(rows, { types: ['Length'] })), ['l1', 'l2']);
  assert.deepEqual(ids(filterMarkupRows(rows, { authors: ['u1'] })), ['l1', 'a1']);
  assert.deepEqual(ids(filterMarkupRows(rows, { layers: ['layer-e'] })), ['t1']);
  assert.deepEqual(ids(filterMarkupRows(rows, { measuresOnly: true, authors: ['u2'] })), ['l2']);
});

test('facets list what is there, most first', () => {
  const facets = markupFacets(markupRows(DOC), { nameOf });
  assert.deepEqual(facets.types.map((t) => [t.label, t.count]), [['Length', 2], ['Area', 1], ['Rectangle', 1], ['Survey Marker', 1], ['Text box', 1]]);
  assert.deepEqual(facets.authors.map((a) => [a.label, a.count]), [['Eddie Editor', 3], ['Olive Owner', 2], ['No author', 1]]);
  assert.deepEqual(facets.layers.map((l) => l.label), ['Default layer', 'Electrical']);
});

test('CSV: one row per shown mark, formula-safe cells, file name beside the PDF', () => {
  const rows = markupRows({ annotationsByPage: { 1: { objects: [lengthLine('l1', 'u1'), { type: 'textbox', text: '=HYPERLINK("x")', data: { id: 't' } }] } } });
  const csv = markupCsv(rows, { nameOf, documentName: 'A-101' });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Document,Page,Type,Text,Measurement,Quantity,Unit,Author,Layer,Color');
  assert.equal(lines[1], 'A-101,1,Length,,"10\' 0""",10,ft,Olive Owner,Default layer,#ff0000');
  assert.equal(lines[2], 'A-101,1,Text box,"\'=HYPERLINK(""x"")",,,,No author,Default layer,');
  assert.equal(markupCsvFileName('Plan A-101.pdf'), 'Plan A-101 markups.csv');
});

test('markup-list is a beta flag with a migration row, and the rail wires the panel', () => {
  assert.equal(FEATURE_FLAGS['markup-list'].stage, 'beta');
  assert.match(readFileSync(new URL('../supabase/migrations/20261110139000_markup_list_flag.sql', import.meta.url), 'utf8'), /\('markup-list', 'off'/);
  const rail = readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
  assert.match(rail, /markupListEnabled \? \[\{ id: 'markups', label: 'Markups', icon: 'shapes' \}\]/);
  assert.match(rail, /lazy\(\(\) => import\('\.\/sidebar\/MarkupsPanel\.jsx'\)\)/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /markupListEnabled,\n\s+getMarkupSnapshot,/);
});
