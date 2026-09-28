// tests/bulkDeletePlanNameResolution.test.mjs
//
// Cross-author delete modal name resolution (2026-07-17).
//
// Callouts never persist a display-name field (only the stable authorId at
// data.authorId / data.legacyCallout.meta.authorId), so the modal's byAuthor
// breakdown rendered every callout author as "Unknown". Fix lives at the
// NAME-RESOLUTION layer: buildBulkDeletePlan accepts an optional
// resolveAuthorName(authorId) roster lookup (PDFViewer threads in the document
// presence roster's user_id → display_name map). Contracts pinned here:
//
//   1. Callout-projected groups resolve roster names (no more 'Unknown').
//   2. Roster-first precedence: a live roster name beats a stale stamped
//      annotation name (ids are stable, names change).
//   3. Legacy fallback intact: no resolver / resolver-miss → the
//      annotation-carried field chain → 'Unknown' (shapes' behavior does not
//      regress; unattributed marks keep the shapes' unknown-author label).
//   4. A throwing resolver never breaks plan building.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBulkDeletePlan } from '../src/lib/collab/bulkDeletePlan.js';
import { calloutToAnnotationObject } from '../src/utils/calloutAnnotationBridge.js';

const PAGE_SIZE = { width: 612, height: 792 };
const OWNER = 'user-owner-0000';
const ALICE = 'user-alice-1111';
const BOB = 'user-bob-2222';

function makeCallout(id, authorId) {
  return {
    id,
    pageNumber: 1,
    arrowTip: { x: 0.5, y: 0.25 },
    knee: { x: 0.3, y: 0.5 },
    textBoxPosition: { x: 0.1, y: 0.6 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.1,
    text: `text for ${id}`,
    ...(authorId ? { meta: { authorId } } : {}),
    style: { fontFamily: 'Arial', fontSize: 14 },
  };
}

function makeShape(id, authorId, extraData = {}) {
  return {
    id,
    type: 'rect',
    left: 10,
    top: 10,
    width: 40,
    height: 30,
    data: { id, authorId, ...extraData },
  };
}

const rosterResolver = (names) => (authorId) => names[authorId] ?? null;

describe('bulk-delete plan byAuthor name resolution (roster layer)', () => {
  it('resolves callout authors through the roster — callout-projected groups no longer show Unknown', () => {
    const calloutObjA = calloutToAnnotationObject(makeCallout('callout-a', ALICE), PAGE_SIZE);
    const calloutObjB = calloutToAnnotationObject(makeCallout('callout-b', BOB), PAGE_SIZE);
    const ownShape = makeShape('shape-own', OWNER);

    const plan = buildBulkDeletePlan({
      candidateIds: ['shape-own', 'callout-a', 'callout-b'],
      annotations: [ownShape, calloutObjA, calloutObjB],
      viewerId: OWNER,
      documentOwnerId: OWNER,
      resolveAuthorName: rosterResolver({ [ALICE]: 'alice@example.com', [BOB]: 'Bob B.' }),
    });

    // RULED 2026-09-28 owner: open editing + lock — no confirm modal; the plan is 'direct' and byAuthor stays for History/diagnostics.
    assert.equal(plan.mode, 'direct');
    assert.equal(plan.byAuthor[ALICE].name, 'alice@example.com');
    assert.equal(plan.byAuthor[ALICE].count, 1);
    assert.equal(plan.byAuthor[BOB].name, 'Bob B.');
  });

  it('without a resolver, callout authors keep the legacy Unknown label (unchanged baseline)', () => {
    const calloutObjA = calloutToAnnotationObject(makeCallout('callout-a', ALICE), PAGE_SIZE);
    const plan = buildBulkDeletePlan({
      candidateIds: ['callout-a'],
      annotations: [calloutObjA],
      viewerId: OWNER,
      documentOwnerId: OWNER,
    });
    // RULED 2026-09-28 owner: open editing + lock — 'owner-cross-author' collapsed into 'direct'.
    assert.equal(plan.mode, 'direct');
    assert.equal(plan.byAuthor[ALICE].name, 'Unknown');
  });

  it('roster-first precedence: a live roster name beats a stamped annotation authorName', () => {
    const staleStamped = makeShape('shape-stale', ALICE, { authorName: 'Old Stamped Name' });
    const plan = buildBulkDeletePlan({
      candidateIds: ['shape-stale'],
      annotations: [staleStamped],
      viewerId: OWNER,
      documentOwnerId: OWNER,
      resolveAuthorName: rosterResolver({ [ALICE]: 'Fresh Roster Name' }),
    });
    assert.equal(plan.byAuthor[ALICE].name, 'Fresh Roster Name');
  });

  it('resolver miss falls back to the annotation-carried name chain (shapes do not regress)', () => {
    const stamped = makeShape('shape-stamped', ALICE, { authorName: 'Stamped Alice' });
    const plan = buildBulkDeletePlan({
      candidateIds: ['shape-stamped'],
      annotations: [stamped],
      viewerId: OWNER,
      documentOwnerId: OWNER,
      resolveAuthorName: rosterResolver({}), // roster knows nobody
    });
    assert.equal(plan.byAuthor[ALICE].name, 'Stamped Alice');
  });

  it('resolver miss with no annotation name fields resolves Unknown (same label shapes use)', () => {
    const bare = makeShape('shape-bare', ALICE);
    const plan = buildBulkDeletePlan({
      candidateIds: ['shape-bare'],
      annotations: [bare],
      viewerId: OWNER,
      documentOwnerId: OWNER,
      resolveAuthorName: rosterResolver({}),
    });
    assert.equal(plan.byAuthor[ALICE].name, 'Unknown');
  });

  it('collaborator cross-author breakdown resolves roster names too', () => {
    const collab = 'user-collab-3333';
    const foreignCallout = calloutToAnnotationObject(makeCallout('callout-f', ALICE), PAGE_SIZE);
    const ownShape = makeShape('shape-own', collab);
    const plan = buildBulkDeletePlan({
      candidateIds: ['shape-own', 'callout-f'],
      annotations: [ownShape, foreignCallout],
      viewerId: collab,
      documentOwnerId: OWNER,
      resolveAuthorName: rosterResolver({ [ALICE]: 'alice@example.com' }),
    });
    // RULED 2026-09-28 owner: open editing + lock — 'collaborator-cross-author' collapsed into 'direct'.
    assert.equal(plan.mode, 'direct');
    assert.equal(plan.byAuthor[ALICE].name, 'alice@example.com');
  });

  it('a throwing resolver never breaks plan building — falls back to the legacy chain', () => {
    const calloutObj = calloutToAnnotationObject(makeCallout('callout-x', ALICE), PAGE_SIZE);
    const plan = buildBulkDeletePlan({
      candidateIds: ['callout-x'],
      annotations: [calloutObj],
      viewerId: OWNER,
      documentOwnerId: OWNER,
      resolveAuthorName: () => { throw new Error('roster unavailable'); },
    });
    // RULED 2026-09-28 owner: open editing + lock — 'owner-cross-author' collapsed into 'direct'.
    assert.equal(plan.mode, 'direct');
    assert.equal(plan.byAuthor[ALICE].name, 'Unknown');
  });
});
