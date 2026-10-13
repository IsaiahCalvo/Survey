// tests/phase35/buildBulkDeletePlan.test.mjs
// Phase 35 Wave 0 scaffold (Plan 35-01) — runs as test.skip until Plan 35-04
// lands src/lib/collab/bulkDeletePlan.js.
//
// Per-test existsSync skip-guard pattern lifted verbatim from Phase 27/28/29
// scaffolds. Each test inlines the skip guard so the file auto-flips from
// all-skipped to all-running the moment Plan 35-04 commits the production
// planner.
//
// Contract under test (locked here, consumed by Plan 35-04):
//   buildBulkDeletePlan({
//     candidateIds: string[],          // ids the gesture caught
//     annotations: Annotation[],       // current page (or doc) annotations
//     viewerId: string,
//     documentOwnerId: string,
//   }): {
//     mode: 'direct' | 'no-op',       // RULED 2026-09-28 owner: open editing + lock (was the three confirm modes)
//     count: number,                   // total annotations to delete
//     ownIds: string[],                // viewer-authored ids in candidates
//     foreignIds: string[],            // non-viewer-authored ids in candidates (owner only)
//     byAuthor?: { [authorId]: { name, count } }, // present iff mode = 'owner-cross-author'
//   }
//
// 'collaborator-all-mine' triggers the simple-count modal (Plan 35-04 collab modal).
// 'owner-cross-author' triggers the per-author breakdown modal (Plan 35-04 owner modal).
// 'owner-own-only' falls through to the single-delete path (no modal — owner deleting
// only their own marks is no different from a non-owner deleting their own marks).
//
// See .planning/phases/35-per-user-delete-authority-confirm-before-wipe/35-CONTEXT.md
// "Confirmation modal — collaborator's 'delete all of mine'" + "Confirmation modal —
// owner's 'delete everyone's'" for the design rationale.

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET = path.resolve(__dirname, '../../src/lib/collab/bulkDeletePlan.js');
const TARGET_URL = pathToFileURL(TARGET).href;

// --- Fixtures -----------------------------------------------------------

const OWNER_ID = 'user-owner-uuid';
const COLLAB_ID = 'user-collab-uuid';
const ALICE_ID = 'user-alice-uuid';
const BOB_ID = 'user-bob-uuid';
const CAROL_ID = 'user-carol-uuid';

function makeAnno(id, authorId, authorName) {
  return {
    id,
    authorId,
    data: { authorId, authorName: authorName ?? `Name-${authorId}` },
  };
}

// --- Tests --------------------------------------------------------------

test(
  "buildBulkDeletePlan #1: returns { mode: 'direct', count, ownIds, foreignIds: [] } when collaborator's selection contains only their own marks",
  { skip: !existsSync(TARGET) ? 'bulkDeletePlan module not yet present (Plan 35-04)' : false },
  async () => {
    const { buildBulkDeletePlan } = await import(TARGET_URL);
    const annotations = [
      makeAnno('a1', COLLAB_ID),
      makeAnno('a2', COLLAB_ID),
      makeAnno('a3', COLLAB_ID),
    ];
    const result = buildBulkDeletePlan({
      candidateIds: ['a1', 'a2', 'a3'],
      annotations,
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    });
    // RULED 2026-09-28 owner: open editing + lock — no confirm modes; own-only deletes go straight through.
    strictEqual(result.mode, 'direct');
    strictEqual(result.count, 3);
    deepStrictEqual([...result.ownIds].sort(), ['a1', 'a2', 'a3']);
    deepStrictEqual(result.foreignIds, []);
  },
);

test(
  "buildBulkDeletePlan #2: returns { mode: 'direct', count, ownIds, foreignIds, byAuthor: { [authorId]: { name, count } } } when owner's selection has at least one foreign-author mark (breakdown is informational)",
  { skip: !existsSync(TARGET) ? 'bulkDeletePlan module not yet present (Plan 35-04)' : false },
  async () => {
    const { buildBulkDeletePlan } = await import(TARGET_URL);
    const annotations = [
      makeAnno('a1', OWNER_ID, 'OwnerName'),
      makeAnno('a2', OWNER_ID, 'OwnerName'),
      makeAnno('a3', ALICE_ID, 'Alice'),
      makeAnno('a4', ALICE_ID, 'Alice'),
      makeAnno('a5', BOB_ID, 'Bob'),
    ];
    const result = buildBulkDeletePlan({
      candidateIds: ['a1', 'a2', 'a3', 'a4', 'a5'],
      annotations,
      viewerId: OWNER_ID,
      documentOwnerId: OWNER_ID,
    });
    // RULED 2026-09-28 owner: open editing + lock — cross-author deletes are direct (no modal); byAuthor stays as info.
    strictEqual(result.mode, 'direct');
    strictEqual(result.count, 5);
    deepStrictEqual([...result.ownIds].sort(), ['a1', 'a2']);
    deepStrictEqual([...result.foreignIds].sort(), ['a3', 'a4', 'a5']);
    ok(result.byAuthor, 'byAuthor breakdown present');
    strictEqual(result.byAuthor[ALICE_ID].name, 'Alice');
    strictEqual(result.byAuthor[ALICE_ID].count, 2);
    strictEqual(result.byAuthor[BOB_ID].name, 'Bob');
    strictEqual(result.byAuthor[BOB_ID].count, 1);
  },
);

test(
  "buildBulkDeletePlan #3: returns { mode: 'direct', count, ownIds, foreignIds: [] } when the page also holds foreign marks that were not in the candidate set (only candidates are planned)",
  { skip: !existsSync(TARGET) ? 'bulkDeletePlan module not yet present (Plan 35-04)' : false },
  async () => {
    const { buildBulkDeletePlan } = await import(TARGET_URL);
    const annotations = [
      makeAnno('a1', COLLAB_ID),
      makeAnno('a2', COLLAB_ID),
      // Foreign marks live alongside, but they should NOT make it into the
      // candidate set in real code (selection scope drops them upstream). The
      // planner's defensive contract is to filter them out anyway:
      makeAnno('a3', ALICE_ID, 'Alice'),
      makeAnno('a4', BOB_ID, 'Bob'),
    ];
    const result = buildBulkDeletePlan({
      // Caller defensively passed only the own-IDs (matches Plan 35-03's
      // marquee/eraser scope filter behavior). Even if the caller had passed
      // the foreign IDs by accident, the planner must still produce
      // 'collaborator-all-mine' for a non-owner viewer.
      candidateIds: ['a1', 'a2'],
      annotations,
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    });
    // RULED 2026-09-28 owner: open editing + lock — the old 'collaborator-all-mine' mode is now 'direct'.
    strictEqual(result.mode, 'direct');
    strictEqual(result.count, 2);
    deepStrictEqual([...result.ownIds].sort(), ['a1', 'a2']);
    deepStrictEqual(result.foreignIds, []);
  },
);

test(
  "buildBulkDeletePlan #3b: collaborator deleting another author's selected callout deletes it directly; a user-locked one is a no-op",
  { skip: !existsSync(TARGET) ? 'bulkDeletePlan module not yet present (Plan 35-04)' : false },
  async () => {
    const { buildBulkDeletePlan } = await import(TARGET_URL);
    const foreign = makeAnno('foreign-callout', OWNER_ID, 'OwnerName');
    const result = buildBulkDeletePlan({
      candidateIds: ['foreign-callout'],
      annotations: [foreign],
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    });
    // RULED 2026-09-28 owner: open editing + lock — no cross-author confirmation; the foreign callout deletes directly.
    strictEqual(result.mode, 'direct');
    deepStrictEqual(result.ownIds, []);
    deepStrictEqual(result.foreignIds, ['foreign-callout']);
    // RULED 2026-09-28 owner: open editing + lock — a user-locked foreign callout is refused (no-op) instead.
    const locked = makeAnno('locked-callout', OWNER_ID, 'OwnerName');
    locked.data.lockedBy = OWNER_ID;
    const lockedResult = buildBulkDeletePlan({
      candidateIds: ['locked-callout'],
      annotations: [locked],
      viewerId: COLLAB_ID,
      documentOwnerId: OWNER_ID,
    });
    strictEqual(lockedResult.mode, 'no-op');
    strictEqual(lockedResult.count, 0);
    deepStrictEqual(lockedResult.lockedIds, ['locked-callout']);
  },
);

test(
  "buildBulkDeletePlan #4: returns { mode: 'direct' } when owner's selection contains only owner's own marks (NO modal)",
  { skip: !existsSync(TARGET) ? 'bulkDeletePlan module not yet present (Plan 35-04)' : false },
  async () => {
    const { buildBulkDeletePlan } = await import(TARGET_URL);
    const annotations = [
      makeAnno('a1', OWNER_ID),
      makeAnno('a2', OWNER_ID),
    ];
    const result = buildBulkDeletePlan({
      candidateIds: ['a1', 'a2'],
      annotations,
      viewerId: OWNER_ID,
      documentOwnerId: OWNER_ID,
    });
    // RULED 2026-09-28 owner: open editing + lock — the old 'owner-own-only' mode is now 'direct'.
    strictEqual(result.mode, 'direct');
    strictEqual(result.count, 2);
    deepStrictEqual([...result.ownIds].sort(), ['a1', 'a2']);
    deepStrictEqual(result.foreignIds, []);
  },
);

test(
  "buildBulkDeletePlan #5: byAuthor breakdown groups by authorId and surfaces authorName from annotation.data.authorName fallback chain ('authorName' || 'lastEditorName' || 'Unknown')",
  { skip: !existsSync(TARGET) ? 'bulkDeletePlan module not yet present (Plan 35-04)' : false },
  async () => {
    const { buildBulkDeletePlan } = await import(TARGET_URL);
    // Three foreign authors with varying name fields:
    const aliceAnno = makeAnno('a1', ALICE_ID, 'Alice');
    // Bob has no authorName but has lastEditorName — fallback should pick that up.
    const bobAnno = {
      id: 'a2',
      authorId: BOB_ID,
      data: { authorId: BOB_ID, lastEditorName: 'Bob' },
    };
    // Carol has neither — falls back to 'Unknown'.
    const carolAnno = {
      id: 'a3',
      authorId: CAROL_ID,
      data: { authorId: CAROL_ID },
    };
    const ownAnno = makeAnno('a0', OWNER_ID, 'OwnerName');
    const annotations = [ownAnno, aliceAnno, bobAnno, carolAnno];

    const result = buildBulkDeletePlan({
      candidateIds: ['a0', 'a1', 'a2', 'a3'],
      annotations,
      viewerId: OWNER_ID,
      documentOwnerId: OWNER_ID,
    });
    // RULED 2026-09-28 owner: open editing + lock — the old 'owner-cross-author' mode is now 'direct'; the breakdown is still built.
    strictEqual(result.mode, 'direct');
    strictEqual(result.byAuthor[ALICE_ID].name, 'Alice');
    strictEqual(result.byAuthor[ALICE_ID].count, 1);
    strictEqual(result.byAuthor[BOB_ID].name, 'Bob', 'lastEditorName fallback applied when authorName missing');
    strictEqual(result.byAuthor[BOB_ID].count, 1);
    strictEqual(result.byAuthor[CAROL_ID].name, 'Unknown', 'final Unknown fallback when both name fields missing');
    strictEqual(result.byAuthor[CAROL_ID].count, 1);
    // Owner's own marks must NOT appear in byAuthor (the breakdown is "from other people"):
    strictEqual(result.byAuthor[OWNER_ID], undefined, 'owner does not appear in byAuthor (own marks counted separately)');
  },
);

test(
  'buildBulkDeletePlan #6: pure function — never mutates inputs',
  { skip: !existsSync(TARGET) ? 'bulkDeletePlan module not yet present (Plan 35-04)' : false },
  async () => {
    const { buildBulkDeletePlan } = await import(TARGET_URL);
    const annotations = [
      makeAnno('a1', COLLAB_ID),
      makeAnno('a2', COLLAB_ID),
      makeAnno('a3', ALICE_ID, 'Alice'),
    ];
    const candidateIds = ['a1', 'a2', 'a3'];
    const annotationsBefore = JSON.stringify(annotations);
    const candidateIdsBefore = JSON.stringify(candidateIds);

    buildBulkDeletePlan({
      candidateIds,
      annotations,
      viewerId: OWNER_ID,
      documentOwnerId: OWNER_ID,
    });

    strictEqual(JSON.stringify(annotations), annotationsBefore, 'annotations array not mutated');
    strictEqual(JSON.stringify(candidateIds), candidateIdsBefore, 'candidateIds array not mutated');
  },
);
