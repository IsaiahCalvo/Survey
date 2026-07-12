/* checklistArchiveFlow.test.mjs
 *
 * KAL-44 — unit tests for the archive-checklist-item helpers.
 *
 * The companion file `templatesEditorStableIds.test.mjs` (added in the earlier
 * orphan-cleanup attempt on `fix/checklist-item-delete-orphan-cleanup`) covers
 * the hard-delete confirmation path. This file covers the archive flow added
 * for KAL-44 final.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  archiveChecklistItem,
  isActiveChecklistItem,
  isArchivedChecklistItem,
  archivedItemLabel,
  collectLiveChecklistIds,
  countMarkersReferencingItem,
  stripOrphanResponseKeys,
} from '../src/services/checklistOrphanCleanup.js';

test('archiveChecklistItem flips archived flag and snapshots label', () => {
  const item = { id: 'i_abc', text: 'Pull cable' };
  const at = '2026-05-21T20:00:00.000Z';
  const archived = archiveChecklistItem(item, { archivedAt: at });
  assert.equal(archived.archived, true);
  assert.equal(archived.archivedAt, at);
  assert.equal(archived.lastKnownLabel, 'Pull cable');
  /* original untouched */
  assert.equal(item.archived, undefined);
  assert.equal(item.lastKnownLabel, undefined);
});

test('archiveChecklistItem is idempotent — second call returns same ref', () => {
  const item = archiveChecklistItem(
    { id: 'i_abc', text: 'Pull cable' },
    { archivedAt: '2026-05-21T20:00:00.000Z' },
  );
  const again = archiveChecklistItem(item);
  assert.equal(again, item);
});

test('archiveChecklistItem preserves an explicit label override', () => {
  const archived = archiveChecklistItem(
    { id: 'i_abc', text: 'New label after edit' },
    { label: 'Original label captured at archive time', archivedAt: '2026-05-21T20:00:00.000Z' },
  );
  assert.equal(archived.lastKnownLabel, 'Original label captured at archive time');
});

test('isActiveChecklistItem treats missing flag as active', () => {
  assert.equal(isActiveChecklistItem({ id: 'i_abc', text: 'x' }), true);
  assert.equal(isActiveChecklistItem({ id: 'i_abc', text: 'x', archived: false }), true);
  assert.equal(isActiveChecklistItem({ id: 'i_abc', text: 'x', archived: true }), false);
  assert.equal(isActiveChecklistItem(null), false);
});

test('isArchivedChecklistItem is the strict complement', () => {
  assert.equal(isArchivedChecklistItem({ archived: true }), true);
  assert.equal(isArchivedChecklistItem({ archived: false }), false);
  assert.equal(isArchivedChecklistItem({}), false);
  assert.equal(isArchivedChecklistItem(null), false);
});

test('archivedItemLabel prefers lastKnownLabel, then text, then fallback', () => {
  assert.equal(
    archivedItemLabel({ lastKnownLabel: 'old', text: 'new' }),
    'old',
  );
  assert.equal(archivedItemLabel({ text: 'just text' }), 'just text');
  assert.equal(archivedItemLabel({ name: 'just name' }), 'just name');
  assert.equal(archivedItemLabel({}), 'Archived item');
  assert.equal(archivedItemLabel(null), 'Archived item');
});

test('collectLiveChecklistIds includes archived items (they still live in template)', () => {
  const template = {
    modules: [{
      id: 'm1',
      categories: [{
        id: 'c1',
        checklist: [
          { id: 'i_active' },
          { id: 'i_archived', archived: true, lastKnownLabel: 'Was Used' },
        ],
      }],
    }],
  };
  const ids = collectLiveChecklistIds(template);
  assert.equal(ids.has('i_active'), true);
  assert.equal(ids.has('i_archived'), true);
});

test('stripOrphanResponseKeys preserves archived item responses (their ids are still live)', () => {
  const liveIds = new Set(['i_active', 'i_archived']);
  const responses = {
    i_active: { selection: 'Y' },
    i_archived: { selection: 'N' },
    i_hard_deleted: { selection: 'Y' },
  };
  const { cleaned, removedKeys } = stripOrphanResponseKeys(responses, liveIds);
  assert.deepEqual(removedKeys, ['i_hard_deleted']);
  assert.equal(cleaned.i_active.selection, 'Y');
  assert.equal(cleaned.i_archived.selection, 'N');
  assert.equal(cleaned.i_hard_deleted, undefined);
});

test('countMarkersReferencingItem counts only markers with the key present', () => {
  const markers = {
    a1: { checklistResponses: { i_x: { selection: 'Y' }, i_y: { selection: 'N' } } },
    a2: { checklistResponses: { i_x: { selection: '' } } },
    a3: { checklistResponses: { i_y: { selection: 'N/A' } } },
    a4: { /* no responses */ },
  };
  assert.equal(countMarkersReferencingItem(markers, 'i_x'), 2);
  assert.equal(countMarkersReferencingItem(markers, 'i_y'), 2);
  assert.equal(countMarkersReferencingItem(markers, 'i_z'), 0);
});

test('archive flow round-trip — buildRich-style normalisation preserves archived metadata', () => {
  /* This simulates the post-buildRich shape (item with archived: true) being
     fed back to richToTemplate-equivalent persistence: the archive metadata
     survives. We can't import buildRich (it's defined inside the JSX file),
     so we exercise the logical contract: archive a freshly-built item and
     re-archive — the second pass is a no-op and metadata round-trips through
     a structuredClone serialisation boundary. */
  const original = { id: 'i_abc', text: 'Pull cable' };
  const archivedAt = '2026-05-21T20:00:00.000Z';
  const archived = archiveChecklistItem(original, { archivedAt });
  /* Serialise + deserialise like a Supabase round-trip would. */
  const roundTripped = JSON.parse(JSON.stringify(archived));
  assert.equal(roundTripped.archived, true);
  assert.equal(roundTripped.archivedAt, archivedAt);
  assert.equal(roundTripped.lastKnownLabel, 'Pull cable');
  /* Filtering: roundTripped no longer appears as active. */
  assert.equal(isActiveChecklistItem(roundTripped), false);
  assert.equal(isArchivedChecklistItem(roundTripped), true);
});

test('archive flow + UI contract — active filter drops archived items, archived filter keeps them', () => {
  const checklist = [
    { id: 'i1', text: 'Item 1' },
    { id: 'i2', text: 'Item 2', archived: true, lastKnownLabel: 'Item 2 (was)' },
    { id: 'i3', text: 'Item 3' },
  ];
  const active = checklist.filter(isActiveChecklistItem);
  const archived = checklist.filter(isArchivedChecklistItem);
  assert.deepEqual(active.map(x => x.id), ['i1', 'i3']);
  assert.deepEqual(archived.map(x => x.id), ['i2']);
});

test('integration — archive a used item, reload preserves marker response and archive flag', () => {
  /* Simulate the lifecycle:
     1. Template has item i1 with marker M1 holding a response for i1.
     2. Editor archives i1 (sets archived: true, lastKnownLabel: 'Pull cable').
     3. Template is persisted + reloaded.
     4. Marker M1 still holds the response under i1.
     5. The archived UI section finds the archived item by id and renders
        the response under lastKnownLabel.

     This is the integration the marker checklist UI relies on. */

  // Initial state.
  let template = {
    modules: [{
      id: 'm1',
      categories: [{
        id: 'c1',
        checklist: [{ id: 'i1', text: 'Pull cable' }],
      }],
    }],
  };
  const marker = {
    id: 'M1',
    categoryId: 'c1',
    moduleId: 'm1',
    checklistResponses: { i1: { selection: 'Y' } },
  };

  // Archive step.
  const archivedAt = '2026-05-21T20:00:00.000Z';
  template = {
    ...template,
    modules: template.modules.map(m => ({
      ...m,
      categories: m.categories.map(c => ({
        ...c,
        checklist: c.checklist.map(it =>
          it.id === 'i1' ? archiveChecklistItem(it, { archivedAt }) : it,
        ),
      })),
    })),
  };

  // Reload — round-trip through JSON.
  const reloaded = JSON.parse(JSON.stringify(template));
  const reloadedMarker = JSON.parse(JSON.stringify(marker));

  // Liveness — i1 still in the template, still archived.
  const liveIds = collectLiveChecklistIds(reloaded);
  assert.equal(liveIds.has('i1'), true);
  const reloadedItem = reloaded.modules[0].categories[0].checklist.find(x => x.id === 'i1');
  assert.equal(reloadedItem.archived, true);
  assert.equal(reloadedItem.lastKnownLabel, 'Pull cable');

  // Old marker still surfaces the response.
  assert.equal(reloadedMarker.checklistResponses.i1.selection, 'Y');

  // The marker UI's archived section can resolve a label for this response.
  assert.equal(archivedItemLabel(reloadedItem), 'Pull cable');

  // A "new marker" created after archive has no response under i1, and the
  // active list now contains no items (only the archived one), so the new
  // marker sees zero active prompts in this category.
  const activeForNewMarker = reloaded.modules[0].categories[0].checklist.filter(isActiveChecklistItem);
  assert.deepEqual(activeForNewMarker, []);
});

test('stripOrphanResponseKeys returns empty cleaned map for non-objects', () => {
  assert.deepEqual(stripOrphanResponseKeys(null, new Set(['a'])), { cleaned: {}, removedKeys: [] });
  assert.deepEqual(stripOrphanResponseKeys('x', new Set()), { cleaned: {}, removedKeys: [] });
});
