// tests/calloutAuthorAttribution.test.mjs
//
// R2.2 Slice 0 — attribution-on-reload invariants for callouts.
//
// The bug being closed: the live path never stamped meta.authorId onto
// callouts[] entries. The pushed row's user_id was right (the serializer
// resolves it), but the reload payload (fabricObject.data.legacyCallout — the
// ONLY thing deserializeRowToCallout recovers) carried no author. After a
// reload the author chain resolved empty, so the shared canModify delete gate
// fell open and the next push re-stamped the current viewer as creator.
//
// Invariants proven here (per R22-R23-EXECUTION-PLAN.md Slice 0):
//   1. create → push → reload → getAnnotationAuthorId === creator.
//   2. A collaborator's push NEVER flips authorship (never-overwrite guard),
//      at the row level AND inside the embedded reload payload.
//   3. The serializer backstop mutates the fabric object IN PLACE (identity
//      matters to the callout sync fingerprints — no clone).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calloutToAnnotationObject,
} from '../src/utils/calloutAnnotationBridge.js';
import {
  serializeFabricObjectToRow,
  deserializeRowToCallout,
} from '../src/services/annotationTypeSerializers.js';
import { getAnnotationAuthorId } from '../src/lib/collab/permissionScope.js';

const PAGE = { width: 816, height: 1056 };
const DOC = 'doc-attr-test';
const CREATOR = 'user-creator';
const COLLABORATOR = 'user-collaborator';

/** Normalized callout as handleCreateCallout produces it post-Slice-0 (meta stamped). */
function makeCreatedCallout(overrides = {}) {
  return {
    id: 'callout-attr-1',
    pageNumber: 2,
    arrowTip: { x: 0.5, y: 0.25 },
    knee: { x: 0.3, y: 0.5 },
    textBoxPosition: { x: 0.1, y: 0.6 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.1,
    text: 'attribution test',
    meta: { authorId: CREATOR },
    ...overrides,
  };
}

function pushAndReload(fabricObj, userId) {
  const row = serializeFabricObjectToRow(fabricObj, {
    documentId: DOC,
    userId,
    pageNumber: 2,
  });
  return { row, reloaded: deserializeRowToCallout(row) };
}

describe('callout attribution — create → push → reload', () => {
  it('reloaded callout resolves the creator via getAnnotationAuthorId', () => {
    const callout = makeCreatedCallout();
    const obj = calloutToAnnotationObject(callout, PAGE);
    const { row, reloaded } = pushAndReload(obj, CREATOR);
    assert.equal(row.user_id, CREATOR);
    assert.equal(getAnnotationAuthorId(reloaded), CREATOR);
  });

  it('survives a second push cycle after reload (no re-stamp drift)', () => {
    const callout = makeCreatedCallout();
    const obj = calloutToAnnotationObject(callout, PAGE);
    const first = pushAndReload(obj, CREATOR);
    // Re-project the reloaded callout and push again as the creator.
    const obj2 = calloutToAnnotationObject(first.reloaded, PAGE);
    const second = pushAndReload(obj2, CREATOR);
    assert.equal(second.row.user_id, CREATOR);
    assert.equal(getAnnotationAuthorId(second.reloaded), CREATOR);
  });
});

describe('callout attribution — serializer backstop (legacy unstamped rows)', () => {
  it('mirrors the resolved group author into legacyCallout.meta.authorId when the embedded chain is empty', () => {
    // Simulate a pre-Slice-0 projected object: group carries the author at
    // data.authorId, but the embedded reload payload has NO chain at all.
    const callout = makeCreatedCallout({ meta: undefined });
    delete callout.meta;
    const obj = calloutToAnnotationObject({ ...callout, authorId: CREATOR }, PAGE);
    delete obj.data.legacyCallout.meta; // force the legacy (unstamped) payload shape
    delete obj.data.legacyCallout.authorId;
    assert.equal(getAnnotationAuthorId(obj.data.legacyCallout), null);

    const { row, reloaded } = pushAndReload(obj, CREATOR);
    assert.equal(row.annotation_data.fabricObject.data.legacyCallout.meta.authorId, CREATOR);
    assert.equal(getAnnotationAuthorId(reloaded), CREATOR);
  });

  it('backstop stamps from the RESOLVED group chain, not the pushing user', () => {
    // Group authored by CREATOR (data.authorId), pushed by COLLABORATOR: the
    // embedded payload must record CREATOR.
    const callout = makeCreatedCallout();
    delete callout.meta;
    const obj = calloutToAnnotationObject({ ...callout, authorId: CREATOR }, PAGE);
    delete obj.data.legacyCallout.meta;
    delete obj.data.legacyCallout.authorId;

    const { row, reloaded } = pushAndReload(obj, COLLABORATOR);
    assert.equal(row.user_id, CREATOR);
    assert.equal(getAnnotationAuthorId(reloaded), CREATOR);
    assert.equal(row.last_modified_by, COLLABORATOR);
  });

  it('fully-empty chain (true CREATE at the serializer): stamps the pushing user everywhere', () => {
    const callout = makeCreatedCallout();
    delete callout.meta;
    const obj = calloutToAnnotationObject(callout, PAGE);
    assert.equal(getAnnotationAuthorId(obj), null);

    const { row, reloaded } = pushAndReload(obj, CREATOR);
    assert.equal(obj.meta.authorId, CREATOR, 'group stamped');
    assert.equal(row.user_id, CREATOR);
    assert.equal(getAnnotationAuthorId(reloaded), CREATOR, 'reload payload stamped');
  });

  it('mutates the fabric object in place — no clone (identity contract)', () => {
    const callout = makeCreatedCallout();
    delete callout.meta;
    const obj = calloutToAnnotationObject(callout, PAGE);
    const legacyBefore = obj.data.legacyCallout;
    const row = serializeFabricObjectToRow(obj, {
      documentId: DOC,
      userId: CREATOR,
      pageNumber: 2,
    });
    assert.equal(row.annotation_data.fabricObject, obj, 'same fabricObject reference');
    assert.equal(obj.data.legacyCallout, legacyBefore, 'same legacyCallout reference');
    assert.equal(legacyBefore.meta.authorId, CREATOR, 'stamped in place');
  });
});

describe('callout attribution — collaborator push never flips authorship', () => {
  it('row user_id and embedded payload keep the creator when a collaborator pushes', () => {
    const callout = makeCreatedCallout(); // meta.authorId = CREATOR
    const obj = calloutToAnnotationObject(callout, PAGE);
    const { row, reloaded } = pushAndReload(obj, COLLABORATOR);
    assert.equal(row.user_id, CREATOR);
    assert.equal(row.annotation_data.fabricObject.data.legacyCallout.meta.authorId, CREATOR);
    assert.equal(getAnnotationAuthorId(reloaded), CREATOR);
    assert.equal(row.last_modified_by, COLLABORATOR);
  });

  it('collaborator edit after reload keeps the creator through a full second cycle', () => {
    const callout = makeCreatedCallout();
    const obj = calloutToAnnotationObject(callout, PAGE);
    const first = pushAndReload(obj, CREATOR);
    // Collaborator edits the reloaded callout (text change) and pushes.
    const edited = { ...first.reloaded, text: 'edited by collaborator' };
    const obj2 = calloutToAnnotationObject(edited, PAGE);
    const second = pushAndReload(obj2, COLLABORATOR);
    assert.equal(second.row.user_id, CREATOR);
    assert.equal(getAnnotationAuthorId(second.reloaded), CREATOR);
    assert.equal(second.reloaded.text, 'edited by collaborator');
  });
});
