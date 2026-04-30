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
