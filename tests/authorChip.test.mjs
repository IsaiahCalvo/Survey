// Nightly 'author-chip' (Drawboard Projects parity SS-03 / SS-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorChipText, authorGroups } from '../src/utils/authorChip.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const mark = (authorId, createdAt, layerId) => ({ type: 'rect', ...(layerId ? { layerId } : {}), data: { authorId, createdAt } });

test('one mark reads "who · date"; one author reads the name; more read a count', () => {
  const one = authorGroups([mark('me', '2026-11-15T12:00:00Z')], { viewerId: 'me', locale: 'en-US' });
  assert.equal(authorChipText(one), 'You · Nov 15, 2026');
  const two = authorGroups([mark('me', '2026-11-15T12:00:00Z'), mark('me', '2026-11-14T12:00:00Z')], { viewerId: 'me', locale: 'en-US' });
  assert.equal(authorChipText(two), 'You');
  const people = new Map([['ana', { id: 'ana', name: 'Ana Ruiz' }]]);
  const mixed = authorGroups([mark('ana', '2026-11-13T12:00:00Z'), mark('me', '2026-11-15T12:00:00Z'), mark(null, null)], { viewerId: 'me', peopleById: people, locale: 'en-US' });
  assert.equal(authorChipText(mixed), '3 people');
  assert.deepEqual(mixed.map((g) => g.label), ['You', 'Ana Ruiz', 'Unknown']);
  assert.equal(authorChipText([]), '');
  // No one known (a PDF's own marks, or marks made with no account): no chip.
  assert.equal(authorChipText(authorGroups([{ type: 'rect' }, { type: 'path' }], { viewerId: null })), '');
});

test('groups list marks newest first with their layer names', () => {
  const layerState = { layers: [{ id: 'L1', name: 'Base', visible: true }, { id: 'L2', name: 'Fire', visible: true }], activeLayerId: 'L1' };
  const [group] = authorGroups([mark('me', '2026-11-10T12:00:00Z', 'L1'), mark('me', '2026-11-15T12:00:00Z', 'L2')], { viewerId: 'me', layerState, locale: 'en-US' });
  assert.deepEqual(group.marks.map((m) => [m.date, m.layer]), [['Nov 15, 2026', 'Fire'], ['Nov 10, 2026', 'Base']]);
});

test('flag is beta; the bar, AppShell and the viewer feed it; a migration adds the row', () => {
  assert.equal(FEATURE_FLAGS['author-chip'].stage, 'rollout');
  assert.match(read('src/components/SelectionQuickBar.jsx'), /isFeatureOn\('author-chip'\)/);
  assert.match(read('src/AppShell.jsx'), /layerState=\{leftRailApi\?\.layerState \|\| null\}/);
  assert.match(read('src/PDFViewer.jsx'), /isFeatureOn\('author-chip'\)\) \? annotationsByPage : null/);
  assert.match(read('supabase/migrations/20261115214300_author_chip_flag.sql'), /'author-chip', 'off'/);
});
