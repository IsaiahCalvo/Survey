// 2026-04-30 hardening — authorship preservation across collaborator edits.
//
// Bug shape this guards against (audit AUDIT-2026-04-30.md, finding #6):
//   Annotation A is created by Alice. Bob (a collaborator) moves it 2px. Bob's
//   edit re-serializes the annotation and stamps `last_modified_by = Bob` AND
//   `user_id = Bob`, overwriting Alice's authorship. Original-author tracking
//   is broken on every cross-author edit.
//
// Invariant under test (canonical chain in src/lib/collab/permissionScope.js
// getAnnotationAuthorId):
//   meta.authorId > authorId > data.authorId > data.userId
//
// Rules the serializer MUST honor:
//   1. Brand-new annotation (no chain field set) → meta.authorId stamped to
//      current user, row.user_id = current user.
//   2. Existing annotation with meta.authorId = 'alice' → Bob's edit must NOT
//      change meta.authorId. last_modified_by = Bob. row.user_id = 'alice'.
//   3. Existing annotation with only data.userId = 'alice' (legacy pre-v2.4)
//      → that legacy field is preserved, no NEW meta.authorId stamp on top
//      that would shadow it. row.user_id = 'alice'.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  serializeFabricObjectToRow,
  serializeCalloutToRow
} from '../../src/services/annotationTypeSerializers.js';

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const ALICE = 'alice-uuid-aaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'bob-uuid-bbbbbbbbbbbbbbbbbbbbbbbbbb';

// ----------------------------------------------------------------------------
// (a) Brand-new annotation: stamp meta.authorId on the creator.
// ----------------------------------------------------------------------------

test('authorship: new annotation gets meta.authorId stamped to current user', () => {
  const fabricObj = {
    type: 'rect',
    left: 10, top: 10, width: 50, height: 30,
    scaleX: 1, scaleY: 1,
    stroke: '#000', strokeWidth: 1, fill: null,
    id: 'rect-new-1'
    // no meta, no authorId, no data.authorId, no data.userId — true CREATE
  };
  const row = serializeFabricObjectToRow(fabricObj, {
    documentId: DOC_ID,
    userId: ALICE,
    pageNumber: 1
  });

  // The fabric object should now carry meta.authorId = ALICE.
  assert.equal(fabricObj.meta?.authorId, ALICE, 'meta.authorId stamped on creator');
  // The row carries it too: user_id is the original author, last_modified_by
  // is also Alice on initial create.
  assert.equal(row.user_id, ALICE);
  assert.equal(row.last_modified_by, ALICE);
  // The serialized fabricObject inside annotation_data carries meta.authorId
  // so a roundtrip back to a peer device preserves it.
  assert.equal(row.annotation_data.fabricObject.meta.authorId, ALICE);
});

// ----------------------------------------------------------------------------
// (b) Existing annotation with meta.authorId = Alice — Bob's edit preserves it.
// ----------------------------------------------------------------------------

test('authorship: Bob editing Alice-authored annotation does NOT overwrite meta.authorId', () => {
  // Alice's annotation, already attributed via the canonical Phase 29 field.
  const aliceAnnotation = {
    type: 'rect',
    left: 12, top: 12, width: 50, height: 30, // Bob nudged it 2px right + down
    scaleX: 1, scaleY: 1,
    stroke: '#000', strokeWidth: 1, fill: null,
    id: 'rect-alice-1',
    meta: { authorId: ALICE, deviceId: 'device-alice', createdAt: 1714400000000 }
  };

  // Bob serializes the edit (Bob is the current viewer / userId).
  const row = serializeFabricObjectToRow(aliceAnnotation, {
    documentId: DOC_ID,
    userId: BOB,
    pageNumber: 1
  });

  // meta.authorId is STILL Alice — never overwritten.
  assert.equal(aliceAnnotation.meta.authorId, ALICE, 'meta.authorId stays Alice');
  // The row reflects the original author for RLS / audit.
  assert.equal(row.user_id, ALICE, 'row.user_id stays Alice (original author)');
  // last_modified_by carries the "who edited last" signal — Bob.
  assert.equal(row.last_modified_by, BOB, 'last_modified_by is Bob (current editor)');
  // The serialized fabricObject inside annotation_data also stays attributed
  // to Alice — peers reading this row see Alice as author.
  assert.equal(
    row.annotation_data.fabricObject.meta.authorId,
    ALICE,
    'serialized meta.authorId stays Alice'
  );
});

// ----------------------------------------------------------------------------
// (c) Legacy-only annotation: data.userId = Alice — no NEW meta.authorId stomp.
// ----------------------------------------------------------------------------

test('authorship: legacy data.userId is preserved, no new meta.authorId shadow', () => {
  // Pre-v2.4 fixture: only data.userId carries the author. The canonical chain
  // resolves through data.userId, so the serializer must NOT stamp a new
  // meta.authorId on top — that would shadow the legacy field with the
  // CURRENT user's id (Bob), which is exactly the bug we're guarding against.
  const legacyAnnotation = {
    type: 'rect',
    left: 0, top: 0, width: 20, height: 20,
    scaleX: 1, scaleY: 1,
    stroke: '#000', strokeWidth: 1, fill: null,
    id: 'rect-legacy-1',
    data: { userId: ALICE }
  };

  const row = serializeFabricObjectToRow(legacyAnnotation, {
    documentId: DOC_ID,
    userId: BOB,
    pageNumber: 1
  });

  // Legacy field is unchanged.
  assert.equal(legacyAnnotation.data.userId, ALICE, 'legacy data.userId preserved');
  // No new meta.authorId stamp — the existing chain has Alice already.
  assert.equal(
    legacyAnnotation.meta?.authorId,
    undefined,
    'no new meta.authorId shadow over legacy data.userId'
  );
  // Row reflects the legacy-resolved author.
  assert.equal(row.user_id, ALICE, 'row.user_id resolves to legacy Alice');
  assert.equal(row.last_modified_by, BOB);
});

// Same coverage for top-level authorId and data.authorId fields in the chain —
// each must keep ownership pinned to whatever value already exists.

test('authorship: existing top-level authorId is preserved on collaborator edit', () => {
  const annotation = {
    type: 'rect',
    left: 0, top: 0, width: 20, height: 20,
    scaleX: 1, scaleY: 1,
    stroke: '#000', strokeWidth: 1, fill: null,
    id: 'rect-toplevel-1',
    authorId: ALICE
  };
  const row = serializeFabricObjectToRow(annotation, {
    documentId: DOC_ID,
    userId: BOB,
    pageNumber: 1
  });
  assert.equal(annotation.authorId, ALICE);
  assert.equal(annotation.meta?.authorId, undefined, 'no shadow stamp');
  assert.equal(row.user_id, ALICE);
  assert.equal(row.last_modified_by, BOB);
});

test('authorship: existing data.authorId is preserved on collaborator edit', () => {
  const annotation = {
    type: 'rect',
    left: 0, top: 0, width: 20, height: 20,
    scaleX: 1, scaleY: 1,
    stroke: '#000', strokeWidth: 1, fill: null,
    id: 'rect-dataauthor-1',
    data: { authorId: ALICE }
  };
  const row = serializeFabricObjectToRow(annotation, {
    documentId: DOC_ID,
    userId: BOB,
    pageNumber: 1
  });
  assert.equal(annotation.data.authorId, ALICE);
  assert.equal(annotation.meta?.authorId, undefined, 'no shadow stamp');
  assert.equal(row.user_id, ALICE);
  assert.equal(row.last_modified_by, BOB);
});

// ----------------------------------------------------------------------------
// Callouts share the same invariant — they live in their own state slice but
// flow through serializeCalloutToRow which must honor the same chain.
// ----------------------------------------------------------------------------

test('authorship: callout serializer stamps meta.authorId on CREATE', () => {
  const callout = {
    id: 'co-new-1',
    pageNumber: 2,
    anchor: { x: 10, y: 20 },
    knee: { x: 50, y: 20 },
    label: { left: 60, top: 10, width: 80, height: 20, text: 'note' }
  };
  const row = serializeCalloutToRow(callout, {
    documentId: DOC_ID,
    userId: ALICE
  });
  assert.equal(callout.meta?.authorId, ALICE);
  assert.equal(row.user_id, ALICE);
  assert.equal(row.last_modified_by, ALICE);
});

test('authorship: callout serializer preserves meta.authorId on collaborator edit', () => {
  const callout = {
    id: 'co-alice-1',
    pageNumber: 2,
    anchor: { x: 12, y: 22 }, // Bob nudged the anchor
    knee: { x: 50, y: 20 },
    label: { left: 60, top: 10, width: 80, height: 20, text: 'note' },
    meta: { authorId: ALICE, deviceId: 'device-alice', createdAt: 1714400000000 }
  };
  const row = serializeCalloutToRow(callout, {
    documentId: DOC_ID,
    userId: BOB
  });
  assert.equal(callout.meta.authorId, ALICE, 'callout meta.authorId stays Alice');
  assert.equal(row.user_id, ALICE, 'row.user_id stays Alice');
  assert.equal(row.last_modified_by, BOB, 'last_modified_by is Bob');
});
