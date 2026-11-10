import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorLabel,
  buildMarkupRows,
  filterMarkupRows,
  groupMarkupRows,
  markupRowsToCsv,
} from '../src/utils/markupList.js';
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
  assert.equal(lines[0], 'Page,Kind,Text,Colour,Author,Created');
  assert.equal(lines[1], "1,Text box,'=SUM(A1),,You,");
  assert.equal(lines[2], '2,Text box,"a, ""b""",#f00,Unknown,');
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
