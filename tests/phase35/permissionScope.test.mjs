// tests/phase35/permissionScope.test.mjs
// Phase 35 Wave 0 scaffold (Plan 35-01) — runs as test.skip until Plan 35-02
// lands src/lib/collab/permissionScope.js.
//
// Per-test existsSync skip-guard pattern lifted verbatim from Phase 27/28/29
// scaffolds (e.g. tests/phase28/originBuilder.test.mjs). Each test inlines the
// skip guard so the file auto-flips from all-skipped to all-running the moment
// Plan 35-02 commits the production helper.
//
// Contract under test (locked here, consumed by Plan 35-02):
//   isOwner(userId, documentOwnerId): boolean
//     - true iff userId is non-null and equals documentOwnerId
//     - false on null / undefined inputs
//   canModify({ viewerId, documentOwnerId, annotation }): boolean
//     - true if viewer authored the annotation OR viewer is the document owner
//     - false otherwise
//   filterByAuthor({ viewerId, documentOwnerId, annotations }): Annotation[]
//     - owners get the input array unchanged
//     - collaborators get only annotations they authored
//
// See .planning/phases/35-per-user-delete-authority-confirm-before-wipe/35-CONTEXT.md
// "Selection scope (collaborator role)" + "Selection scope (document author/owner role)"
// for the design rationale.

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET = path.resolve(__dirname, '../../src/lib/collab/permissionScope.js');
const TARGET_URL = pathToFileURL(TARGET).href;

// --- Fixtures -----------------------------------------------------------

const OWNER_ID = 'user-owner-uuid';
const COLLAB_ID = 'user-collab-uuid';
const OTHER_ID = 'user-other-uuid';

function makeAnno(authorId, extra = {}) {
  return {
    id: `anno-${authorId}-${Math.random().toString(36).slice(2, 8)}`,
    authorId,
    data: { authorId, authorName: `Name-${authorId}`, ...extra },
  };
}

// --- Tests --------------------------------------------------------------

test(
  'permissionScope #1: isOwner returns true when userId === documentOwnerId, false otherwise (and false on null/undefined inputs)',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { isOwner } = await import(TARGET_URL);
    strictEqual(isOwner(OWNER_ID, OWNER_ID), true, 'matching ids => true');
    strictEqual(isOwner(COLLAB_ID, OWNER_ID), false, 'mismatching ids => false');
    strictEqual(isOwner(null, OWNER_ID), false, 'null userId => false');
    strictEqual(isOwner(undefined, OWNER_ID), false, 'undefined userId => false');
    strictEqual(isOwner(OWNER_ID, null), false, 'null ownerId => false');
    strictEqual(isOwner(OWNER_ID, undefined), false, 'undefined ownerId => false');
    strictEqual(isOwner(null, null), false, 'both null => false (no false-ownership coincidence)');
  },
);

test(
  'permissionScope #2: isOwner is pure — same inputs always return same output, no side effects',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { isOwner } = await import(TARGET_URL);
    const a = isOwner(OWNER_ID, OWNER_ID);
    const b = isOwner(OWNER_ID, OWNER_ID);
    const c = isOwner(OWNER_ID, OWNER_ID);
    strictEqual(a, b, 'idempotent invocation');
    strictEqual(b, c, 'idempotent invocation');
    // No throw, no global mutation, no async behavior:
    strictEqual(typeof isOwner, 'function');
  },
);

test(
  'permissionScope #3: canModify returns true when annotation authorId matches viewerId (collaborator owns it)',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { canModify } = await import(TARGET_URL);
    const own = makeAnno(COLLAB_ID);
    strictEqual(
      canModify({ viewerId: COLLAB_ID, documentOwnerId: OWNER_ID, annotation: own }),
      true,
      'collaborator can modify their own marks',
    );
  },
);

test(
  'permissionScope #4: canModify returns true when isOwner(viewerId, documentOwnerId) is true regardless of annotation authorId (owner can modify any)',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { canModify } = await import(TARGET_URL);
    const foreign = makeAnno(COLLAB_ID);
    strictEqual(
      canModify({ viewerId: OWNER_ID, documentOwnerId: OWNER_ID, annotation: foreign }),
      true,
      "owner can modify a collaborator's mark",
    );
    const otherForeign = makeAnno(OTHER_ID);
    strictEqual(
      canModify({ viewerId: OWNER_ID, documentOwnerId: OWNER_ID, annotation: otherForeign }),
      true,
      "owner can modify any author's mark",
    );
  },
);

test(
  'permissionScope #5: canModify returns false when viewerId is non-owner AND annotation authorId !== viewerId (locked from interaction)',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { canModify } = await import(TARGET_URL);
    const foreign = makeAnno(OTHER_ID);
    strictEqual(
      canModify({ viewerId: COLLAB_ID, documentOwnerId: OWNER_ID, annotation: foreign }),
      false,
      "collaborator cannot modify another user's mark",
    );
  },
);

test(
  'permissionScope #5b: canDelete allows an authenticated editor path to request confirmation for a foreign annotation',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { canDelete } = await import(TARGET_URL);
    const foreign = makeAnno(OTHER_ID);
    strictEqual(
      canDelete({ viewerId: COLLAB_ID, documentOwnerId: OWNER_ID, annotation: foreign }),
      true,
      'foreign deletion reaches the confirmation planner; read-only viewers are gated above this layer',
    );
  },
);

test(
  'permissionScope #5c: annotationId does not bypass ownership unless the object is a canonical Survey Marker',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { canEraseCanvasAnnotation } = await import(TARGET_URL);
    const foreignOrdinaryAnnotation = {
      type: 'path',
      annotationId: 'ambiguous-id',
      data: { authorId: OTHER_ID },
    };
    const callbackCalls = [];
    const canEraseSurveyMarker = (annotationId) => {
      callbackCalls.push(annotationId);
      return true;
    };

    for (const eraserMode of ['partial', 'entire']) {
      strictEqual(
        canEraseCanvasAnnotation({
          annotation: foreignOrdinaryAnnotation,
          knownSurveyMarkerIds: new Set(),
          canEraseSurveyMarker,
          viewerId: COLLAB_ID,
          documentOwnerId: OWNER_ID,
          eraserMode,
        }),
        false,
        `${eraserMode} erase must keep the foreign ordinary annotation locked`,
      );
    }
    deepStrictEqual(callbackCalls, [], 'ordinary annotation never enters Survey Marker permission');

    strictEqual(
      canEraseCanvasAnnotation({
        annotation: foreignOrdinaryAnnotation,
        knownSurveyMarkerIds: new Set(['ambiguous-id']),
        canEraseSurveyMarker,
        viewerId: COLLAB_ID,
        documentOwnerId: OWNER_ID,
      }),
      true,
      'the same ID uses the marker callback only when the canonical marker source contains it',
    );
    deepStrictEqual(callbackCalls, ['ambiguous-id']);
  },
);

test(
  'permissionScope #5d: unresolved viewer, owner, or author context fails closed without blocking proven self/owner cases',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { canEraseCanvasAnnotation } = await import(TARGET_URL);
    const knownIds = new Set();
    const foreign = {
      type: 'path',
      annotationId: 'ordinary-foreign-proxy-looking-id',
      data: { id: 'foreign', authorId: OTHER_ID },
    };
    const own = {
      type: 'path',
      data: { id: 'own', authorId: COLLAB_ID },
    };
    const unknownAuthor = {
      type: 'path',
      annotationId: 'ordinary-unknown-proxy-looking-id',
      data: { id: 'unknown-author' },
    };
    const canErase = (annotation, viewerId, documentOwnerId) => (
      canEraseCanvasAnnotation({
        annotation,
        knownSurveyMarkerIds: knownIds,
        canEraseSurveyMarker: null,
        viewerId,
        documentOwnerId,
      })
    );

    strictEqual(canErase(foreign, null, OWNER_ID), false, 'missing viewer denies');
    strictEqual(canErase(foreign, COLLAB_ID, null), false, 'missing owner denies foreign mark');
    strictEqual(canErase(unknownAuthor, COLLAB_ID, OWNER_ID), false, 'missing author denies');
    strictEqual(canErase(own, COLLAB_ID, null), true, 'known self-authorship survives missing owner');
    strictEqual(canErase(foreign, OWNER_ID, OWNER_ID), true, 'known document owner still overrides');
  },
);

test(
  'permissionScope #5e: cloud owner metadata never falls back to the viewer while local-only files keep opener ownership',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { resolveDocumentOwnerId } = await import(TARGET_URL);

    strictEqual(resolveDocumentOwnerId({
      documentId: 'cloud-document-id',
      documentOwnerId: null,
      viewerId: COLLAB_ID,
    }), null, 'registered cloud document stays unresolved');
    strictEqual(resolveDocumentOwnerId({
      documentId: null,
      documentOwnerId: null,
      viewerId: COLLAB_ID,
    }), COLLAB_ID, 'explicit local-only file belongs to its opener');
    strictEqual(resolveDocumentOwnerId({
      documentId: 'cloud-document-id',
      documentOwnerId: OWNER_ID,
      viewerId: COLLAB_ID,
    }), OWNER_ID, 'loaded cloud owner metadata wins');
  },
);

test(
  'permissionScope #5f: destructive eraser commit gates reject forged/stale ids and unresolved marker identity',
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const {
      canCommitSurveyMarkerErase,
      filterEraserCommitIds,
    } = await import(TARGET_URL);
    const own = { id: 'own', data: { authorId: COLLAB_ID } };
    const foreign = { id: 'foreign', data: { authorId: OTHER_ID } };
    const locked = { id: 'locked', locked: true, data: { authorId: COLLAB_ID } };

    deepStrictEqual(filterEraserCommitIds({
      annotationIds: ['foreign', 'missing', 'locked', 'own'],
      annotations: [own, foreign, locked],
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }), ['own'], 'commit rechecks a forged/stale preview hit list');
    deepStrictEqual(filterEraserCommitIds({
      annotationIds: ['own'],
      annotations: [own],
      viewerId: COLLAB_ID,
      documentOwnerId: null,
    }), [], 'missing owner denies callout commit');

    const marker = { userId: COLLAB_ID };
    strictEqual(canCommitSurveyMarkerErase({
      surveyMarker: marker,
      viewerId: COLLAB_ID,
      documentOwnerId: null,
    }), false, 'missing marker owner denies commit');
    strictEqual(canCommitSurveyMarkerErase({
      surveyMarker: marker,
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }), true, 'resolved self-owned marker remains erasable');
  },
);

test(
  "permissionScope #6: filterByAuthor returns only annotations the viewer can modify (drops other authors' marks for collaborator role; returns input array unchanged for owner role)",
  { skip: !existsSync(TARGET) ? 'permissionScope module not yet present (Plan 35-02)' : false },
  async () => {
    const { filterByAuthor } = await import(TARGET_URL);
    const mine1 = makeAnno(COLLAB_ID);
    const mine2 = makeAnno(COLLAB_ID);
    const theirs1 = makeAnno(OTHER_ID);
    const theirs2 = makeAnno(OWNER_ID);
    const all = [mine1, theirs1, mine2, theirs2];

    // Collaborator: only own marks survive.
    const collabResult = filterByAuthor({
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
      annotations: all,
    });
    deepStrictEqual(
      collabResult.map((a) => a.id),
      [mine1.id, mine2.id],
      'collaborator filter retains only own annotations, in input order',
    );

    // Owner: input unchanged.
    const ownerResult = filterByAuthor({
      viewerId: OWNER_ID,
      documentOwnerId: OWNER_ID,
      annotations: all,
    });
    ok(Array.isArray(ownerResult), 'owner result is an array');
    deepStrictEqual(
      ownerResult.map((a) => a.id),
      all.map((a) => a.id),
      'owner filter is identity (no drops)',
    );
  },
);
