import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorLabel,
  buildMarkupRows,
  filterMarkupRows,
  groupMarkupRows,
  markupRowsToCsv,
  markupTotals,
  measureQuantity,
} from '../src/utils/markupList.js';
import { scaleFromPreset, stampMeasure } from '../src/utils/measure/measureScale.js';
import { addLayer } from '../src/utils/layers.js';
import { PANEL_IDS } from '../src/sidebar/panelLayoutStore.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const byPage = {
  2: { objects: [
    { id: 'r1', type: 'rect', stroke: '#ff0000', meta: { authorId: 'u1', createdAt: '2026-11-09T10:00:00Z' } },
    { id: 'h1', type: 'rect', visible: false },
    { id: 's1', type: 'region' },
  ] },
  1: { objects: [
    { id: 't1', type: 'textbox', text: 'Check  this\nvalve', fill: '#000', meta: { authorId: 'u2' } },
    { id: 'c1', type: 'path', data: { lineStyle: 'cloud' }, stroke: 'transparent', fill: '#00f' },
    { id: 'f1', type: 'form-field' },
    { type: 'line', data: { helper: true } },
    { type: 'weird' },
  ] },
};

test('rows: pages in order, hidden, helper and page furniture left out', () => {
  const rows = buildMarkupRows(byPage);
  assert.deepEqual(rows.map((r) => r.id), ['t1', 'c1', 'p1-i4', 'r1']);
  assert.equal(rows[0].kind, 'text');
  assert.equal(rows[0].text, 'Check this valve');
  assert.equal(rows[1].kind, 'cloud');
  assert.equal(rows[1].color, '#00f');
  assert.equal(rows[2].kind, 'mark');
  assert.equal(rows[3].authorId, 'u1');
  assert.equal(rows[3].createdAt, '2026-11-09T10:00:00Z');
  assert.deepEqual(buildMarkupRows(null), []);
});

test('author words', () => {
  const people = new Map([['u2', { id: 'u2', name: null, email: 'sam@x.com' }]]);
  assert.equal(authorLabel('u1', { viewerId: 'u1' }), 'You');
  assert.equal(authorLabel('u2', { peopleById: people }), 'sam');
  assert.equal(authorLabel('u9', { peopleById: people }), 'Someone');
  assert.equal(authorLabel(null), 'Unknown');
});

test('filter by words, kind and person', () => {
  const rows = buildMarkupRows(byPage);
  const labelFor = (id) => authorLabel(id, { viewerId: 'u1' });
  assert.deepEqual(filterMarkupRows(rows, { query: 'valve' }).map((r) => r.id), ['t1']);
  assert.deepEqual(filterMarkupRows(rows, { query: 'p2' }).map((r) => r.id), ['r1']);
  assert.deepEqual(filterMarkupRows(rows, { query: 'you', labelFor }).map((r) => r.id), ['r1']);
  assert.deepEqual(filterMarkupRows(rows, { kinds: new Set(['cloud']) }).map((r) => r.id), ['c1']);
  assert.deepEqual(filterMarkupRows(rows, { authors: new Set(['']) }).map((r) => r.id), ['c1', 'p1-i4']);
  assert.equal(filterMarkupRows(rows, {}).length, 4);
});

test('groups follow the kind order', () => {
  const groups = groupMarkupRows(buildMarkupRows(byPage));
  assert.deepEqual(groups.map((g) => g.kind), ['cloud', 'text', 'rect', 'mark']);
  assert.equal(groups[0].label, 'Clouds');
});

test('CSV quotes and blocks spreadsheet formulas', () => {
  const csv = markupRowsToCsv([
    { pageNumber: 1, kindLabel: 'Text box', text: '=SUM(A1)', color: null, authorId: 'u1', createdAt: '' },
    { pageNumber: 2, kindLabel: 'Text box', text: 'a, "b"', color: '#f00', authorId: null, createdAt: '' },
  ], { labelFor: (id) => (id ? 'You' : 'Unknown') });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Page,Kind,Text,Colour,Author,Created,Quantity,Unit,Layer');
  assert.equal(lines[1], "1,Text box,'=SUM(A1),,You,,,,");
  assert.equal(lines[2], '2,Text box,"a, ""b""",#f00,Unknown,,,,');
});

test('panel and flag are wired', () => {
  assert.ok(PANEL_IDS.includes('markups'));
  assert.equal(FEATURE_FLAGS['markup-list']?.stage, 'beta');
});

test('counters list as Counter, with their disc colour and an ISO time (R3-M B3)', async () => {
  const { buildMarkupRows, markupRowsToCsv } = await import('../src/utils/markupList.js');
  const at = 1794273682855;
  const rows = buildMarkupRows({
    1: { objects: [{ type: 'circle', id: 'c1', fill: '#2563eb', stroke: '#ffffff', radius: 14, data: { type: 'counter', createdAt: at, displayNumber: 1 } }] },
  });
  assert.equal(rows[0].kind, 'counter');
  assert.equal(rows[0].kindLabel, 'Counter');
  assert.equal(rows[0].color, '#2563eb');
  assert.equal(rows[0].createdAt, new Date(at).toISOString());
  assert.match(markupRowsToCsv(rows), /Counter,,#2563eb,,2026-/);
});

test('a callout lists its words, its border colour and when it was made', async () => {
  const { calloutToAnnotationObject } = await import('../src/utils/calloutAnnotationBridge.js');
  const callout = {
    id: 'c9',
    text: 'Check fixture spacing',
    arrowTip: { x: 0.1, y: 0.1 }, knee: { x: 0.2, y: 0.2 },
    textBoxPosition: { x: 0.3, y: 0.3 }, textBoxWidth: 0.2, textBoxHeight: 0.05,
    style: { borderColor: '#DC2626', fontColor: '#DC2626' },
    meta: { authorId: 'u1', createdAt: 1762750000000 },
  };
  const group = calloutToAnnotationObject(callout, { width: 612, height: 792 });
  const [row] = buildMarkupRows({ 1: { objects: [group] } });
  assert.equal(row.kind, 'callout');
  assert.equal(row.text, 'Check fixture spacing');
  assert.equal(row.color, '#DC2626');
  assert.equal(row.createdAt, new Date(1762750000000).toISOString());
  assert.equal(filterMarkupRows([row], { query: 'fixture' }).length, 1);
  const csv = markupRowsToCsv([row]);
  assert.match(csv, /Callout,Check fixture spacing,#DC2626,/);
});

test('rgb() colours are written as hex in the list and CSV', () => {
  const rows = buildMarkupRows({ 1: { objects: [
    { id: 'a', type: 'line', stroke: 'rgba(255, 0, 0, 1)' },
    { id: 'b', type: 'line', stroke: 'rgba(0, 128, 255, 0.5)' },
    { id: 'c', type: 'line', stroke: 'rgb(16,32,48)' },
  ] } });
  assert.deepEqual(rows.map((r) => r.color), ['#FF0000', '#0080FF80', '#102030']);
});

// Measurements, layers and totals (joined in from the second Markups panel
// build, 2026-11-10).
const QUARTER = scaleFromPreset('1/4'); // 18 pt per foot
const ROOM = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 90 }, { x: 0, y: 90 }]; // 10 ft x 5 ft
// A 180 pt line = 10 ft.
const lengthLine = (id, author) => stampMeasure({ type: 'line', left: 0, top: 0, width: 180, height: 0, x1: -90, y1: 0, x2: 90, y2: 0, stroke: '#ff0000', id, meta: { authorId: author } }, 'length', QUARTER);
const area = (id, author) => stampMeasure({ type: 'polygon', points: ROOM, id, meta: { authorId: author } }, 'area', QUARTER);
const { state: layerState } = addLayer(null, { name: 'Electrical', id: 'layer-e' });
const MEASURED = {
  1: { objects: [lengthLine('l1', 'u1'), lengthLine('l2', 'u2'), { id: 'r1', type: 'rect', stroke: '#00ff00' }] },
  2: { objects: [area('a1', 'u1'), { id: 't1', type: 'textbox', text: 'Check valve', layerId: 'layer-e', meta: { authorId: 'u2' } }] },
};

test('measurements carry their real quantity and unit; no scale reads paper inches', () => {
  const rows = buildMarkupRows(MEASURED);
  assert.deepEqual(rows.find((r) => r.id === 'l1').measure, { kind: 'length', name: 'Length', text: '10\' 0"', quantity: 10, unit: 'ft', dimension: 'length', scaled: true });
  assert.equal(rows.find((r) => r.id === 'a1').measure.quantity, 50);
  assert.equal(rows.find((r) => r.id === 'a1').measure.unit, 'sq ft');
  assert.equal(rows.find((r) => r.id === 'r1').measure, null);
  const bare = { type: 'line', left: 0, top: 0, width: 144, height: 0, x1: -72, y1: 0, x2: 72, y2: 0, data: { measure: { kind: 'length' } } };
  assert.deepEqual(measureQuantity(bare), { kind: 'length', name: 'Length', text: '2 in (no scale)', quantity: 2, unit: 'in', dimension: 'length', scaled: false });
});

test('totals add like with like', () => {
  assert.deepEqual(markupTotals(buildMarkupRows(MEASURED)).map((t) => [t.name, t.quantity, t.unit, t.count]), [
    ['Length', 20, 'ft', 2],
    ['Area', 50, 'sq ft', 1],
  ]);
});

test('layer and measurements-only filters; search finds units and layers', () => {
  const rows = buildMarkupRows(MEASURED, { layerState });
  const ids = (list) => list.map((r) => r.id);
  assert.equal(rows.find((r) => r.id === 't1').layerName, 'Electrical');
  assert.deepEqual(ids(filterMarkupRows(rows, { layers: new Set(['layer-e']) })), ['t1']);
  assert.deepEqual(ids(filterMarkupRows(rows, { measuresOnly: true, authors: new Set(['u2']) })), ['l2']);
  assert.deepEqual(ids(filterMarkupRows(rows, { query: 'sq ft' })), ['a1']);
  assert.deepEqual(ids(filterMarkupRows(rows, { query: 'electrical' })), ['t1']);
  // Without the Layers beta no row carries a layer.
  assert.ok(buildMarkupRows(MEASURED).every((r) => r.layerId === null && r.layerName === ''));
});

test('CSV: a measurement\'s Quantity is a plain number in its Unit, beside its layer', () => {
  const lines = markupRowsToCsv(buildMarkupRows(MEASURED, { layerState })).trim().split('\r\n');
  assert.equal(lines[1], '1,Measurement,"10\' 0""",#ff0000,u1,,10,ft,Default layer');
  assert.match(lines[4], /^2,Measurement,.*,50,sq ft,Default layer$/);
  assert.match(lines[5], /^2,Text box,Check valve,.*,,,Electrical$/);
});

test('a named measurement lists by its name and caption, its reading kept', () => {
  const named = stampMeasure({ type: 'polygon', points: ROOM, id: 'v1' }, 'area', QUARTER);
  named.data.measure.label = 'Room 101';
  const [row] = buildMarkupRows({ 1: { objects: [named] } });
  // Its caption (#1381 'measure-edit': label, then reading) on one row.
  assert.equal(row.text, 'Room 101 · 50.00 sq ft');
  assert.equal(row.measure.text, '50.00 sq ft');
});
