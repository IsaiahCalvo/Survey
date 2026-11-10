import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NO_AUTHOR,
  exportAuthors,
  exportLayers,
  exportFilterIsAll,
  applyExportFilter,
  commentsCsv,
  commentsCsvFileName,
} from '../src/utils/exportFilters.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const layerState = { layers: [{ id: 'default', name: 'Default' }, { id: 'l1', name: 'Electrical' }] };

const doc = () => ({
  annotationsByPage: {
    1: { objects: [
      { id: 'a', meta: { authorId: 'u1' } },
      { id: 'b', meta: { authorId: 'u2' }, layerId: 'l1' },
      { id: 'c' },
      { id: 'co', meta: { authorId: 'u2' }, layerId: 'l1', data: { type: 'callout', id: 'call-1' } },
    ] },
    2: { objects: [{ id: 'd', meta: { authorId: 'u1' } }] },
  },
  callouts: [
    { id: 'call-1', authorId: 'u2', layerId: 'l1' },
    { id: 'call-2', authorId: 'u1' },
  ],
  surveyMarkers: { m1: { id: 'm1', userId: 'u2' }, m2: { id: 'm2' } },
});

test('authors are counted, most marks first, unowned marks are "from the PDF"', () => {
  assert.deepEqual(exportAuthors(doc()), [
    { id: 'u2', count: 3 },
    { id: NO_AUTHOR, count: 2 },
    { id: 'u1', count: 2 },
  ]);
});

test('layers that hold marks, in layer order', () => {
  assert.deepEqual(exportLayers(doc(), layerState), [
    { id: 'default', name: 'Default', count: 3 },
    { id: 'l1', name: 'Electrical', count: 2 },
  ]);
  // A mark on a layer that no longer exists counts as Default.
  const stray = { annotationsByPage: { 1: { objects: [{ id: 'x', layerId: 'gone' }] } } };
  assert.deepEqual(exportLayers(stray, layerState), [{ id: 'default', name: 'Default', count: 1 }]);
});

test('no filter keeps the same objects', () => {
  const input = doc();
  assert.equal(exportFilterIsAll(null), true);
  assert.equal(exportFilterIsAll({ authors: null, layers: null }), true);
  assert.equal(exportFilterIsAll({ authors: ['u1'] }), false);
  const out = applyExportFilter(input, null, layerState);
  assert.equal(out.annotationsByPage, input.annotationsByPage);
  assert.equal(out.callouts, input.callouts);
});

test('Who filter keeps one person, their callouts and Survey Markers', () => {
  const input = doc();
  const out = applyExportFilter(input, { authors: ['u2'], layers: null }, layerState);
  assert.deepEqual(out.annotationsByPage[1].objects.map((o) => o.id), ['b', 'co']);
  assert.deepEqual(out.annotationsByPage[2].objects, []);
  assert.deepEqual(out.callouts.map((c) => c.id), ['call-1']);
  assert.deepEqual(Object.keys(out.surveyMarkers), ['m1']);
});

test('Layers filter drops the callout with its page object; markers stay', () => {
  const input = doc();
  const out = applyExportFilter(input, { authors: null, layers: ['default'] }, layerState);
  assert.deepEqual(out.annotationsByPage[1].objects.map((o) => o.id), ['a', 'c']);
  // Page 2 had nothing filtered: same object.
  assert.equal(out.annotationsByPage[2], input.annotationsByPage[2]);
  assert.deepEqual(out.callouts.map((c) => c.id), ['call-2']);
  assert.deepEqual(Object.keys(out.surveyMarkers), ['m1', 'm2']);
});

test('both filters at once', () => {
  const out = applyExportFilter(doc(), { authors: [NO_AUTHOR, 'u1'], layers: ['default'] }, layerState);
  assert.deepEqual(out.annotationsByPage[1].objects.map((o) => o.id), ['a', 'c']);
  assert.deepEqual(out.annotationsByPage[2].objects.map((o) => o.id), ['d']);
  assert.deepEqual(Object.keys(out.surveyMarkers), ['m2']);
});

test('comments CSV: threads together, replies numbered, deleted left out', () => {
  const comments = [
    { id: 'r2', pageNumber: 3, authorId: 'u1', body: 'Later page', createdAt: '2026-11-10T10:00:00Z' },
    { id: 'r1', pageNumber: 1, authorId: 'u1', body: 'Check this, please', createdAt: '2026-11-10T09:00:00Z' },
    { id: 'x1', threadId: 'r1', pageNumber: 1, authorId: 'u2', body: 'Said "done"', createdAt: '2026-11-10T09:05:00Z', editedAt: '2026-11-10T09:06:00Z' },
    { id: 'x2', threadId: 'r1', pageNumber: 1, authorId: 'u2', body: 'gone', createdAt: '2026-11-10T09:07:00Z', deletedAt: '2026-11-10T09:08:00Z' },
    { id: 'x3', threadId: 'r1', pageNumber: 1, authorId: 'u9', body: '=SUM(A1)', createdAt: '2026-11-10T09:09:00Z' },
  ];
  const names = { u1: 'Olive', u2: 'Ben' };
  const csv = commentsCsv(comments, { nameOf: (id) => names[id], documentName: 'A-101.pdf' });
  assert.equal(csv, [
    'Document,Page,Thread,Reply,Author,Date,Edited,Comment',
    'A-101.pdf,1,1,,Olive,2026-11-10T09:00:00Z,,"Check this, please"',
    'A-101.pdf,1,1,1,Ben,2026-11-10T09:05:00Z,yes,"Said ""done"""',
    'A-101.pdf,1,1,2,Someone,2026-11-10T09:09:00Z,,"\'=SUM(A1)"',
    'A-101.pdf,3,2,,Olive,2026-11-10T10:00:00Z,,Later page',
    '',
  ].join('\r\n'));
});

test('comments CSV file name sits beside the PDF', () => {
  assert.equal(commentsCsvFileName('Plan A-101.pdf'), 'Plan A-101 comments.csv');
  assert.equal(commentsCsvFileName(''), 'Document comments.csv');
});

test('export-filters is a Nightly beta flag with a migration row', () => {
  const flag = FEATURE_FLAGS.find?.((f) => f.key === 'export-filters') ?? FEATURE_FLAGS['export-filters'];
  assert.ok(flag, 'flag registered');
  assert.equal(flag.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261110131000_export_filters_flag.sql', import.meta.url), 'utf8');
  assert.match(sql, /'export-filters'/);
});
