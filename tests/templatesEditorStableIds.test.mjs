/* templatesEditorStableIds.test.mjs
 *
 * Focused tests for the checklist orphan-cleanup helpers introduced for KAL-44
 * (surfaced during KAL-43 UAT). When a checklist item is hard-deleted from a
 * template, any survey markers that already had a response keyed under that
 * item id were left with orphan keys in their checklist_responses JSON — the
 * data was preserved but unreachable from the UI.
 *
 * The helpers under test are pure and live in src/services/checklistOrphanCleanup.js.
 * The TemplatesEditor delete flow uses them (via App.jsx hubSaveTemplates) to
 * strip orphan keys after a save.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectLiveChecklistIds,
  stripOrphanResponseKeys,
  countMarkersReferencingItem,
  planOrphanCleanup,
} from '../src/services/checklistOrphanCleanup.js';

describe('checklist orphan cleanup', () => {
  it('collects live checklist ids from a template (modules -> categories -> checklist)', () => {
    const template = {
      id: 't1',
      modules: [
        {
          id: 'm1',
          categories: [
            { id: 'c1', checklist: [{ id: 'i1', text: 'A' }, { id: 'i2', text: 'B' }] },
            { id: 'c2', checklist: [{ id: 'i3', text: 'C' }] },
          ],
        },
        {
          id: 'm2',
          categories: [{ id: 'c3', checklist: [{ id: 'i4', text: 'D' }] }],
        },
      ],
    };
    const ids = collectLiveChecklistIds(template);
    assert.deepEqual([...ids].sort(), ['i1', 'i2', 'i3', 'i4']);
  });

  it('falls back to the legacy `spaces` and `items` field names', () => {
    const template = {
      id: 't1',
      spaces: [
        { id: 'm1', categories: [{ id: 'c1', items: [{ id: 'i1', text: 'A' }] }] },
      ],
    };
    const ids = collectLiveChecklistIds(template);
    assert.deepEqual([...ids], ['i1']);
  });

  it('strips orphan keys from a marker checklist_responses object', () => {
    const responses = {
      i1: { selection: 'yes', note: 'fine' },
      i2: { selection: 'no', note: 'broken' },
      orphanX: { selection: 'maybe' },
    };
    const liveIds = new Set(['i1', 'i2']);
    const { cleaned, removedKeys } = stripOrphanResponseKeys(responses, liveIds);
    assert.deepEqual(Object.keys(cleaned).sort(), ['i1', 'i2']);
    assert.deepEqual(removedKeys, ['orphanX']);
    assert.equal(cleaned.i1.selection, 'yes');
    assert.equal(cleaned.i2.note, 'broken');
  });

  it('handles a missing or non-object responses input safely', () => {
    const liveIds = new Set(['i1']);
    assert.deepEqual(stripOrphanResponseKeys(null, liveIds), { cleaned: {}, removedKeys: [] });
    assert.deepEqual(stripOrphanResponseKeys(undefined, liveIds), { cleaned: {}, removedKeys: [] });
    assert.deepEqual(stripOrphanResponseKeys('nope', liveIds), { cleaned: {}, removedKeys: [] });
  });

  it('counts in-memory markers referencing a given checklist item id', () => {
    const markers = {
      a1: { checklistResponses: { i1: {}, i2: {} } },
      a2: { checklistResponses: { i2: {} } },
      a3: { checklistResponses: {} },
      a4: null,
    };
    assert.equal(countMarkersReferencingItem(markers, 'i2'), 2);
    assert.equal(countMarkersReferencingItem(markers, 'i1'), 1);
    assert.equal(countMarkersReferencingItem(markers, 'never'), 0);
  });

  it('counts Supabase-shaped rows too (checklist_responses snake_case)', () => {
    const rows = [
      { id: 1, checklist_responses: { i1: { selection: 'yes' } } },
      { id: 2, checklist_responses: { i1: { selection: 'no' } } },
    ];
    assert.equal(countMarkersReferencingItem(rows, 'i1'), 2);
  });

  /* ---- main acceptance test for KAL-44 ---- */

  it('delete flow produces no orphan keys when responses existed for the deleted item', () => {
    // Before delete: a template with two checklist items, and two markers that
    // have responses for both.
    const liveIdsBefore = new Set(['itemA', 'itemB']);
    const markerRowsBefore = [
      { id: 'row-1', annotation_id: 'ann-1', checklist_responses: { itemA: { selection: 'yes', note: 'n1' }, itemB: { selection: 'no' } } },
      { id: 'row-2', annotation_id: 'ann-2', checklist_responses: { itemA: { selection: 'maybe' } } },
      { id: 'row-3', annotation_id: 'ann-3', checklist_responses: { itemB: { selection: 'n/a' } } },
    ];

    // Confirm baseline: itemA is referenced by two markers, matching what the
    // delete confirmation modal needs to surface.
    assert.equal(countMarkersReferencingItem(markerRowsBefore, 'itemA'), 2);

    // User deletes itemA from the template editor. The live id set shrinks.
    const liveIdsAfter = new Set(['itemB']);

    // Plan the orphan-cleanup pass.
    const plan = planOrphanCleanup(markerRowsBefore, liveIdsAfter);

    // Two rows had itemA — both must be in the plan; row-3 had no orphan and
    // must NOT be in the plan (avoids needless writes).
    assert.equal(plan.length, 2);
    const planIds = plan.map((p) => p.id).sort();
    assert.deepEqual(planIds, ['row-1', 'row-2']);

    // After applying the plan, no marker has the deleted itemA key, but
    // historical itemB responses are preserved untouched.
    const updated = markerRowsBefore.map((row) => {
      const update = plan.find((p) => p.id === row.id);
      return update ? { ...row, checklist_responses: update.checklist_responses } : row;
    });
    for (const row of updated) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(row.checklist_responses, 'itemA'),
        false,
        `row ${row.id} still has the deleted itemA key`,
      );
    }
    // itemB responses survived.
    assert.equal(updated.find((r) => r.id === 'row-1').checklist_responses.itemB.selection, 'no');
    assert.equal(updated.find((r) => r.id === 'row-3').checklist_responses.itemB.selection, 'n/a');

    // And no other keys snuck in.
    for (const row of updated) {
      for (const key of Object.keys(row.checklist_responses)) {
        assert.ok(liveIdsAfter.has(key), `row ${row.id} has orphan key ${key}`);
      }
    }
  });

  it('plan is empty when there are no orphans (nothing to write)', () => {
    const liveIds = new Set(['i1']);
    const rows = [{ id: 'r1', annotation_id: 'a1', checklist_responses: { i1: { selection: 'yes' } } }];
    const plan = planOrphanCleanup(rows, liveIds);
    assert.equal(plan.length, 0);
  });
});
