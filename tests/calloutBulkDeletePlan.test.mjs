// tests/calloutBulkDeletePlan.test.mjs
//
// R2.2 Slice 4 — callout DELETE rides the shared bulk-delete plan.
//
// Three contracts, exercised through the same pure helpers PDFViewer composes:
//
// 1. buildBulkDeletePlan over a byPage page containing PROJECTED callout group
//    objects (calloutToAnnotationObject output — id lives at data.id, author at
//    data.authorId) resolves the same modes shapes get. RULED 2026-09-28
//    owner: open editing + lock — every eligible delete is 'direct' (no
//    modal, own or cross-author); a user-locked callout is refused ('no-op').
//
// 2. Mixed shape+callout marquee delete → ONE combined save produces ONE
//    fabric:batch history action whose single inversion (one Cmd+Z) restores
//    BOTH halves — and the derive memo revives the callout from the restored
//    group object.
//
// 3. A trash row built from the fabric-shaped delete of a projected callout
//    group carries a fabric:create restoreAction that revives the callout
//    (data.legacyCallout intact) when applied back to byPage.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBulkDeletePlan } from '../src/lib/collab/bulkDeletePlan.js';
import {
  calloutToAnnotationObject,
  deriveCalloutsFromByPage,
  applyCalloutListToByPage,
} from '../src/utils/calloutAnnotationBridge.js';
import {
  buildAnnotationHistoryAction,
  invertAnnotationHistoryAction,
  applyAnnotationHistoryAction,
} from '../src/utils/annotationLocalHistory.js';
import { buildAnnotationDeleteHistoryRow } from '../src/services/annotationTrashHistory.js';

const PAGE_SIZE = { width: 612, height: 792 };
const OWNER = 'user-owner-0000';
const COLLABORATOR = 'user-collab-1111';

function makeCallout(id, pageNumber, authorId, overrides = {}) {
  return {
    id,
    pageNumber,
    arrowTip: { x: 0.5, y: 0.25 },
    knee: { x: 0.3, y: 0.5 },
    textBoxPosition: { x: 0.1, y: 0.6 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.1,
    text: `text for ${id}`,
    ...(authorId ? { meta: { authorId } } : {}),
    style: {
      fontFamily: 'Arial',
      fontSize: 14,
      fontColor: '#000000',
      borderColor: '#1e293b',
      lineThickness: 2,
    },
    ...overrides,
  };
}

function projectGroup(callout) {
  return calloutToAnnotationObject(callout, PAGE_SIZE);
}

/** A shape row the way byPage stores a synced rect (top-level id + data.id). */
function makeRect(id, authorId) {
  return {
    type: 'rect',
    id,
    left: 40,
    top: 40,
    width: 80,
    height: 60,
    stroke: '#ff0000',
    data: { type: 'rect', id, ...(authorId ? { authorId } : {}) },
  };
}

// ─── 1. Plan modes over projected callouts ────────────────────────────────────

describe('buildBulkDeletePlan over projected callout groups (Slice 4 parity)', () => {
  const ownerCallout = projectGroup(makeCallout('c-owner', 1, OWNER));
  const collabCallout = projectGroup(makeCallout('c-collab', 1, COLLABORATOR));
  const pageObjects = [ownerCallout, collabCallout];

  it('resolves callout candidates through data.id (no top-level id on groups)', () => {
    assert.equal(ownerCallout.id, undefined, 'projected group must not carry a top-level id');
    const plan = buildBulkDeletePlan({
      candidateIds: ['c-owner'],
      annotations: pageObjects,
      viewerId: OWNER,
      documentOwnerId: OWNER,
    });
    assert.notEqual(plan.mode, 'no-op', 'planner must find the group via data.id');
  });

  it('owner deleting a cross-author callout selection → direct (no modal)', () => {
    const plan = buildBulkDeletePlan({
      candidateIds: ['c-owner', 'c-collab'],
      annotations: pageObjects,
      viewerId: OWNER,
      documentOwnerId: OWNER,
    });
    // RULED 2026-09-28 owner: open editing + lock — cross-author callout deletes are direct.
    assert.equal(plan.mode, 'direct');
    assert.equal(plan.count, 2);
    assert.deepEqual(plan.ownIds, ['c-owner']);
    assert.deepEqual(plan.foreignIds, ['c-collab']);
    assert.equal(plan.byAuthor[COLLABORATOR].count, 1);
  });

  it('collaborator deleting a mixed-author callout selection → direct (no modal)', () => {
    const plan = buildBulkDeletePlan({
      candidateIds: ['c-owner', 'c-collab'],
      annotations: pageObjects,
      viewerId: COLLABORATOR,
      documentOwnerId: OWNER,
    });
    // RULED 2026-09-28 owner: open editing + lock — collaborators delete others' callouts directly.
    assert.equal(plan.mode, 'direct');
    assert.equal(plan.count, 2);
    assert.deepEqual(plan.ownIds, ['c-collab']);
    assert.deepEqual(plan.foreignIds, ['c-owner']);
  });

  it('owner deleting only their own callouts → direct (silent)', () => {
    const plan = buildBulkDeletePlan({
      candidateIds: ['c-owner'],
      annotations: pageObjects,
      viewerId: OWNER,
      documentOwnerId: OWNER,
    });
    // RULED 2026-09-28 owner: open editing + lock — 'owner-own-only' collapsed into 'direct'.
    assert.equal(plan.mode, 'direct');
    assert.equal(plan.count, 1);
    assert.deepEqual(plan.ownIds, ['c-owner']);
  });

  it('owner + unattributed callout counts as own (solo docs stay silent)', () => {
    const unattributed = projectGroup(makeCallout('c-legacy', 1, null));
    const plan = buildBulkDeletePlan({
      candidateIds: ['c-legacy'],
      annotations: [unattributed],
      viewerId: OWNER,
      documentOwnerId: OWNER,
    });
    // RULED 2026-09-28 owner: open editing + lock — 'owner-own-only' collapsed into 'direct'; unattributed still counts as own.
    assert.equal(plan.mode, 'direct');
    assert.deepEqual(plan.ownIds, ['c-legacy']);
  });

  it('a user-locked callout is refused for everyone (no-op, reported in lockedIds)', () => {
    // RULED 2026-09-28 owner: open editing + lock — the lock is the only delete refusal; it binds the owner too.
    const locked = projectGroup(makeCallout('c-locked', 1, COLLABORATOR, { lockedBy: COLLABORATOR }));
    for (const viewerId of [OWNER, COLLABORATOR]) {
      const plan = buildBulkDeletePlan({
        candidateIds: ['c-locked'],
        annotations: [locked],
        viewerId,
        documentOwnerId: OWNER,
      });
      assert.equal(plan.mode, 'no-op');
      assert.deepEqual(plan.lockedIds, ['c-locked']);
    }
  });

  it('mixed shape+callout candidate set plans across both kinds', () => {
    const rect = makeRect('rect-1', COLLABORATOR);
    const plan = buildBulkDeletePlan({
      candidateIds: ['rect-1', 'c-owner'],
      annotations: [rect, ...pageObjects],
      viewerId: OWNER,
      documentOwnerId: OWNER,
    });
    // RULED 2026-09-28 owner: open editing + lock — mixed shape+callout cross-author delete is direct.
    assert.equal(plan.mode, 'direct');
    assert.equal(plan.count, 2);
    assert.deepEqual(plan.ownIds, ['c-owner']);
    assert.deepEqual(plan.foreignIds, ['rect-1']);
  });
});

// ─── 2. Mixed marquee delete → single undo restores both halves ──────────────

describe('mixed shape+callout marquee delete — single undo restores both', () => {
  it('one combined save diff = ONE fabric:batch; one inversion revives shapes AND callouts', () => {
    const rect = makeRect('rect-1', OWNER);
    const callout = makeCallout('c-1', 1, OWNER);
    const previousPage = applyCalloutListToByPage(
      { 1: { objects: [rect] } },
      [callout],
      { 1: PAGE_SIZE },
    )[1];
    assert.equal(previousPage.objects.length, 2, 'fixture: shape + projected callout group');

    // The combined save (Slice 4): shape removed by the SVG runDelete, the
    // claimed callout group stripped by handleSaveAnnotations' co-delete —
    // both gone in the SAME next-page JSON.
    const nextPage = { ...previousPage, objects: [] };

    const action = buildAnnotationHistoryAction({
      pageNumber: 1,
      previousPage,
      nextPage,
    });
    assert.equal(action.type, 'fabric:batch', 'both halves must land in ONE history action');
    assert.equal(action.deleted.length, 2);
    const deletedIds = action.deleted.map((entry) => entry.id).sort();
    assert.deepEqual(deletedIds, ['c-1', 'rect-1']);

    // Single Cmd+Z: invert once, apply once.
    const inverse = invertAnnotationHistoryAction(action);
    const restoredByPage = applyAnnotationHistoryAction({ 1: nextPage }, inverse);
    const restoredObjects = restoredByPage['1'].objects;
    assert.equal(restoredObjects.length, 2, 'one undo must restore BOTH halves');
    assert.ok(restoredObjects.some((obj) => obj?.data?.id === 'rect-1'), 'shape restored');

    // The derive memo revives the callout from the restored group.
    const revived = deriveCalloutsFromByPage(restoredByPage);
    assert.equal(revived.length, 1);
    assert.equal(revived[0].id, 'c-1');
    assert.equal(revived[0].pageNumber, 1);
    assert.equal(revived[0].text, 'text for c-1');
    assert.equal(revived[0].meta?.authorId, OWNER, 'author chain survives the undo round-trip');
  });
});

// ─── 3. Trash-row restore revives a callout ───────────────────────────────────

describe('fabric-shaped trash row restore revives a callout (Slice 4)', () => {
  it('annotation_deleted row for a projected callout group restores through byPage', () => {
    const callout = makeCallout('c-trash', 3, OWNER);
    const group = projectGroup(callout);
    // What emitBulkTrashRows builds for a single-object callout delete.
    const row = buildAnnotationDeleteHistoryRow({
      deleteAction: {
        type: 'fabric:delete',
        pageNumber: 3,
        annotationId: 'c-trash',
        annotation: JSON.parse(JSON.stringify(group)),
        index: null,
      },
      documentId: 'doc-1',
      userId: OWNER,
      actorName: 'Olive Owner',
      deletedAt: '2026-07-17T00:00:00.000Z',
    });
    assert.ok(row, 'trash row must build');
    assert.equal(row.event_type, 'annotation_deleted');
    assert.match(row.summary, /deleted a callout on page 3/, 'summary must say callout, not annotation');

    const restoreAction = row.payload.restoreAction;
    assert.equal(restoreAction.type, 'fabric:create');
    assert.equal(restoreAction.annotationId, 'c-trash');
    assert.ok(
      restoreAction.annotation?.data?.legacyCallout,
      'restored row must carry data.legacyCallout (the derive memo payload)',
    );

    // Restore path (handleRestoreHistoryActivity): apply onto a page that no
    // longer has the callout.
    const restoredByPage = applyAnnotationHistoryAction({ 3: { objects: [] } }, restoreAction);
    const revived = deriveCalloutsFromByPage(restoredByPage);
    assert.equal(revived.length, 1);
    assert.equal(revived[0].id, 'c-trash');
    assert.equal(revived[0].pageNumber, 3);
    assert.equal(revived[0].text, 'text for c-trash');
    assert.equal(revived[0].meta?.authorId, OWNER);
  });

  it('undo-toast snapshot re-add revives a callout (snapshotObjects → byPage → derive)', () => {
    // Mirrors handleRequestBulkDelete's onUndo: snapshotObjects are appended
    // back to the page's objects verbatim.
    const callout = makeCallout('c-toast', 2, COLLABORATOR);
    const snapshot = JSON.parse(JSON.stringify(projectGroup(callout)));
    const byPageAfterDelete = { 2: { objects: [] } };
    const byPageAfterUndo = {
      ...byPageAfterDelete,
      2: { ...byPageAfterDelete[2], objects: [...byPageAfterDelete[2].objects, snapshot] },
    };
    const revived = deriveCalloutsFromByPage(byPageAfterUndo);
    assert.equal(revived.length, 1);
    assert.equal(revived[0].id, 'c-toast');
    assert.equal(revived[0].meta?.authorId, COLLABORATOR);
  });
});
