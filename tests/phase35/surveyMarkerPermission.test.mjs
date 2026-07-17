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

test('non-owner CANNOT delete another user\'s marker', () => {
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: { userId: OTHER_ID },
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }),
    false,
  );
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

test('unresolvable author DENIES for non-owners (fail closed)', () => {
  strictEqual(
    canModifySurveyMarker({
      surveyMarker: { name: 'orphan marker' },
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    }),
    false,
  );
});

test('non-string author values deny for non-owners (fail closed)', () => {
  for (const userId of [0, false, {}, []]) {
    strictEqual(
      canModifySurveyMarker({
        surveyMarker: { userId },
        viewerId: COLLAB_ID,
        documentOwnerId: OWNER_ID,
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
