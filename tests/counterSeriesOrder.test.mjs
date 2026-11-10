// The counts list's drag to reorder (beta 'counter-list', owner 2026-10-26):
// each pin carries its count's place (data.seriesOrder), the list follows it,
// and a count still named by its place keeps that name when it moves.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCounterSeriesOrderUpdates, getCounterSeriesList } from '../src/utils/counterNumbering.js';
import { buildPdfCounterMetadata } from '../src/utils/pdfCounterMetadata.js';
import { FEATURE_FLAGS, isFeatureOn } from '../src/featureFlags.js';

const pin = (seriesId, createdAt, extra = {}) => ({
  type: 'circle',
  fill: extra.fill || '#ff0000',
  data: { type: 'counter', seriesId, createdAt, numberColor: '#ffffff', ...extra.data },
});

const doc = () => ({
  1: { objects: [pin('a', 1), pin('b', 2), { type: 'rect', data: { type: 'rect' } }] },
  2: { objects: [pin('c', 3, { data: { seriesName: 'Doors' } }), pin('a', 4)] },
  3: { objects: [{ type: 'path', data: { type: 'pen' } }] },
});

const apply = (byPage, updates) => {
  const next = { ...byPage };
  for (const { pageKey, json } of updates) next[pageKey] = json;
  return next;
};

test('counter order: oldest first until the list is reordered', () => {
  assert.deepEqual(getCounterSeriesList(doc()).map((s) => s.label), ['Count 1', 'Count 2', 'Doors']);
});

test('counter order: a reorder writes every pin and keeps place names', () => {
  const byPage = doc();
  const plan = buildCounterSeriesOrderUpdates(byPage, ['c', 'a', 'b']);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.updates.map((u) => u.pageKey).sort(), ['1', '2'], 'pages without counters are left alone');
  const after = apply(byPage, plan.updates);
  const list = getCounterSeriesList(after);
  assert.deepEqual(list.map((s) => s.seriesId), ['c', 'a', 'b']);
  // "Count 1" moved to second place but is still called Count 1.
  assert.deepEqual(list.map((s) => s.label), ['Doors', 'Count 1', 'Count 2']);
  assert.deepEqual(after[2].objects[1].data, { ...byPage[2].objects[1].data, seriesOrder: 1, seriesName: 'Count 1' });
  assert.equal(after[1].objects[2], byPage[1].objects[2], 'other marks are the same objects');
  // Doing it again changes nothing.
  assert.deepEqual(buildCounterSeriesOrderUpdates(after, ['c', 'a', 'b']).updates, []);
});

test('counter order: a count started after a reorder follows the ordered ones', () => {
  const after = apply(doc(), buildCounterSeriesOrderUpdates(doc(), ['b', 'c', 'a']).updates);
  after[3] = { objects: [pin('d', 0.5)] }; // even with an older timestamp
  const list = getCounterSeriesList(after);
  assert.deepEqual(list.map((s) => s.seriesId), ['b', 'c', 'a', 'd']);
  assert.equal(list[3].label, 'Count 4');
});

test('counter order: a stale or partial order is refused', () => {
  assert.equal(buildCounterSeriesOrderUpdates(doc(), ['a', 'b']).ok, false);
  assert.equal(buildCounterSeriesOrderUpdates(doc(), ['a', 'b', 'b']).ok, false);
  assert.equal(buildCounterSeriesOrderUpdates(doc(), ['a', 'b', 'z']).ok, false);
});

test('counter order: the place travels with the pin in an exported PDF', () => {
  const metadata = buildPdfCounterMetadata({
    type: 'circle', left: 10, top: 10, radius: 8, fill: '#ff0000',
    data: { type: 'counter', seriesId: 'a', seriesOrder: 2, displayNumber: 1 },
  }, 1);
  assert.equal(metadata.series.order, 2);
  assert.equal(metadata.data.seriesOrder, 2);
});

test('counter order: the counts list is a beta flag (Survey Nightly only)', () => {
  assert.equal(FEATURE_FLAGS['counter-list'].stage, 'beta');
  const storage = { getItem: () => null };
  assert.equal(isFeatureOn('counter-list', { storage, env: { VITE_RELEASE_CHANNEL: 'nightly' } }), true);
  assert.equal(isFeatureOn('counter-list', { storage: { getItem: () => '1' }, env: {} }), false);
});
