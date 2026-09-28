// tests/phase35/surveyMarkerPermission.test.mjs
// Survey Marker delete-authority adapter (security fix, 2026-07-17).
//
// The bespoke ownership chain inline in PDFViewer's handleSurveyMarkerDeleted
// (`userId || annotationData?.userId || lastModifiedBy`) had two defects:
//   (a) FAILED OPEN — `if (!authorId || !user?.id) return true` let anyone
//       delete a marker whose author could not be resolved;
//   (b) no document-owner override — the canonical canModify lets the document
//       owner modify anyone's annotation, but the inline check did not.
//
// Contract under test (mirrors canModify semantics exactly):
//   getSurveyMarkerAuthorId(surveyMarker): string|null
//     - resolves userId ?? annotationData.userId ?? lastModifiedBy ?? null
//   canModifySurveyMarker({ surveyMarker, viewerId, documentOwnerId }): boolean
//     - document owner may modify ANY marker (owner override, checked first)
//     - non-owner may modify only markers they authored
//     - unresolvable author → DENY for non-owners (fail closed)

import { test } from 'node:test';
import { strictEqual } from 'node:assert/strict';

import {
  getSurveyMarkerAuthorId,
  canModifySurveyMarker,
} from '../../src/lib/collab/permissionScope.js';

// --- Fixtures -----------------------------------------------------------

const OWNER_ID = 'user-owner-uuid';
const COLLAB_ID = 'user-collab-uuid';
const OTHER_ID = 'user-other-uuid';

// --- getSurveyMarkerAuthorId: marker-field resolution order ---------------

test('getSurveyMarkerAuthorId resolves top-level userId first', () => {
  strictEqual(
    getSurveyMarkerAuthorId({
      userId: COLLAB_ID,
      annotationData: { userId: OTHER_ID },
      lastModifiedBy: OTHER_ID,
    }),
    COLLAB_ID,
  );
});

test('getSurveyMarkerAuthorId falls back to annotationData.userId', () => {
  strictEqual(
    getSurveyMarkerAuthorId({
      annotationData: { userId: COLLAB_ID },
      lastModifiedBy: OTHER_ID,
    }),
    COLLAB_ID,
  );
});

test('getSurveyMarkerAuthorId falls back to lastModifiedBy last', () => {
  strictEqual(getSurveyMarkerAuthorId({ lastModifiedBy: COLLAB_ID }), COLLAB_ID);
});

test('getSurveyMarkerAuthorId returns null when no author field is present', () => {
  strictEqual(getSurveyMarkerAuthorId({ name: 'Marker 1', pageNumber: 2 }), null);
  strictEqual(getSurveyMarkerAuthorId(null), null);
  strictEqual(getSurveyMarkerAuthorId(undefined), null);
});

// --- canModifySurveyMarker: authority semantics ----------------------------

test('author can delete their own marker (each author field resolves)', () => {
  const markers = [
    { userId: COLLAB_ID },
    { annotationData: { userId: COLLAB_ID } },
    { lastModifiedBy: COLLAB_ID },
  ];
  for (const surveyMarker of markers) {
    strictEqual(
      canModifySurveyMarker({
        surveyMarker,
        viewerId: COLLAB_ID,
        documentOwnerId: OWNER_ID,
      }),
      true,
    );
  }
});

test('non-owner CAN delete another user\'s marker, but nobody can delete a user-locked one', () => {
  // RULED 2026-09-28 owner: open editing + lock — any editor may delete anyone's Survey Marker.
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: { userId: OTHER_ID },
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }),
    true,
  );
  // RULED 2026-09-28 owner: open editing + lock — the refusal moves to the user lock, which binds author and owner too.
  for (const viewerId of [COLLAB_ID, OTHER_ID, OWNER_ID]) {
    strictEqual(
      canModifySurveyMarker({
        surveyMarker: { userId: OTHER_ID, lockedBy: OTHER_ID },
        viewerId,
        documentOwnerId: OWNER_ID,
      }),
      false,
    );
  }
});

test('document owner CAN delete anyone\'s marker (owner override)', () => {
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: { userId: COLLAB_ID },
      viewerId: OWNER_ID,
      documentOwnerId: OWNER_ID,
    }),
    true,
  );
});

test('document owner CAN delete a marker with an unresolvable author', () => {
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: { name: 'orphan marker' },
      viewerId: OWNER_ID,
      documentOwnerId: OWNER_ID,
    }),
    true,
  );
});

test('unresolvable author is open to non-owner editors once the owner is known; fails closed while the owner is unknown', () => {
  // RULED 2026-09-28 owner: open editing + lock — unattributed markers are editable by any editor.
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: { name: 'orphan marker' },
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }),
    true,
  );
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: { name: 'orphan marker' },
      viewerId: COLLAB_ID,
      documentOwnerId: null,
    }),
    false,
  );
});

test('non-string author values deny for non-owners while the owner is unknown (fail closed)', () => {
  for (const userId of [0, false, {}, []]) {
    // RULED 2026-09-28 owner: open editing + lock — with a known owner any editor is admitted, so fail-closed is pinned on the owner-unknown window.
    strictEqual(
      canModifySurveyMarker({
        surveyMarker: { userId },
        viewerId: COLLAB_ID,
        documentOwnerId: null,
      }),
      false,
    );
  }
});

test('missing viewerId denies for non-owners (fail closed, matches canModify)', () => {
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: { userId: COLLAB_ID },
      viewerId: null,
      documentOwnerId: OWNER_ID,
    }),
    false,
  );
});

// --- Edit (move/resize/rotate) gate — handleSurveyMarkerBoundsChange -------
//
// PDFViewer's handleSurveyMarkerBoundsChange routes edit authority through the
// same canModifySurveyMarker adapter as the delete gate (geometry mutations
// previously had NO authority check at all). These tests pin the edit-gate
// contract explicitly with drag-shaped marker fixtures.

function makeMoveMarker(extra = {}) {
  return {
    annotationId: 'marker-move-1',
    pageNumber: 3,
    bounds: { x: 10, y: 20, width: 40, height: 30, angle: 0 },
    ...extra,
  };
}

test('edit gate: author can move/resize their own marker', () => {
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: makeMoveMarker({ userId: COLLAB_ID }),
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }),
    true,
  );
});

test('edit gate: non-owner CAN move another user\'s marker, but not a user-locked one', () => {
  // RULED 2026-09-28 owner: open editing + lock — any editor may move anyone's Survey Marker.
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: makeMoveMarker({ userId: OTHER_ID }),
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }),
    true,
  );
  // RULED 2026-09-28 owner: open editing + lock — a user-locked marker refuses the move.
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: makeMoveMarker({ userId: OTHER_ID, lockedBy: OTHER_ID }),
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }),
    false,
  );
});

test('edit gate: document owner CAN move anyone\'s marker (owner override)', () => {
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: makeMoveMarker({ userId: COLLAB_ID }),
      viewerId: OWNER_ID,
      documentOwnerId: OWNER_ID,
    }),
    true,
  );
});

test('edit gate: unresolvable author denies move for non-owners while the owner is unknown (fail closed)', () => {
  // RULED 2026-09-28 owner: open editing + lock — with a known owner an unattributed marker is movable; fail-closed stays for the owner-unknown window.
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: makeMoveMarker(),
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }),
    true,
  );
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: makeMoveMarker(),
      viewerId: COLLAB_ID,
      documentOwnerId: null,
    }),
    false,
  );
});
