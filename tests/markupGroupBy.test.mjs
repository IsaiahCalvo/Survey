// KAL-724 (Nightly 'markup-group-by'): the Markups list groups by kind (as
// before), page (Drawboard's Annotation History) or person.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MARKUP_GROUPINGS, authorLabel, buildMarkupRows, groupMarkupRows } from '../src/utils/markupList.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const byPage = {
  3: { objects: [
    { id: 'a', type: 'rect', stroke: '#f00', meta: { authorId: 'u2' } },
  ] },
  1: { objects: [
    { id: 'b', type: 'textbox', text: 'Valve', meta: { authorId: 'u1' } },
    { id: 'c', type: 'rect', stroke: '#0f0' },
    { id: 'd', type: 'rect', stroke: '#00f', meta: { authorId: 'u1' } },
  ] },
};

test('by page: "Page N" groups in page order, rows in page order', () => {
  const groups = groupMarkupRows(buildMarkupRows(byPage), { by: 'page' });
  assert.deepEqual(groups.map((g) => g.label), ['Page 1', 'Page 3']);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['b', 'c', 'd']);
  assert.deepEqual(groups.map((g) => g.kind), ['page:1', 'page:3']);
});

test('by person: one group per author, by name; no author falls under its label', () => {
  const people = new Map([['u2', { id: 'u2', name: 'Alex' }]]);
  const labelFor = (id) => authorLabel(id, { viewerId: 'u1', peopleById: people });
  const groups = groupMarkupRows(buildMarkupRows(byPage), { by: 'author', labelFor });
  assert.deepEqual(groups.map((g) => g.label), ['Alex', 'Unknown', 'You']);
  assert.deepEqual(groups.find((g) => g.label === 'You').rows.map((r) => r.id), ['b', 'd']);
});

test('by kind stays the default', () => {
  const rows = buildMarkupRows(byPage);
  assert.deepEqual(groupMarkupRows(rows), groupMarkupRows(rows, { by: 'kind' }));
  assert.deepEqual(MARKUP_GROUPINGS.map((g) => g.label), ['Kind', 'Page', 'Person']);
});

test('wiring: Nightly flag, the pick in the panel, kept on the device', () => {
  assert.equal(FEATURE_FLAGS['markup-group-by']?.stage, 'beta');
  const panel = readFileSync(new URL('../src/sidebar/MarkupsPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /isFeatureOn\('markup-group-by'\)/);
  assert.match(panel, /groupMarkupRows\(shown, \{ by: groupBy, labelFor \}\)/);
  assert.match(panel, /data-markups-group-by/);
  const migration = readFileSync(new URL('../supabase/migrations/20261117124000_markup_group_by_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'markup-group-by', 'off'/);
});

test('a mark drawn with the Cloud tool lists as a Cloud, a clouded text box as a text box', () => {
  const rows = buildMarkupRows({ 1: { objects: [
    { id: 'k', type: 'rect', stroke: '#f00', data: { pdfCloudIntensity: 2 } },
    { id: 'p', type: 'polygon', stroke: '#f00', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }], data: { pdfCloudIntensity: 1 } },
    { id: 't', type: 'textbox', text: 'Note', data: { pdfCloudIntensity: 2 } },
  ] } });
  assert.deepEqual(rows.map((r) => r.kind), ['cloud', 'cloud', 'text']);
});
