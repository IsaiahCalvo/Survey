// tests/phase35/contributorCrossAuthorShapes.test.mjs
// RULED 2026-09-28 owner: open editing + lock — this file now pins the open
// model: cross-author shape deletes are DIRECT (no confirm modal), Cut and
// the eraser take any unlocked mark, and the user lock is the only refusal.
// The history below describes the superseded 2026-07-17 model.
// Locked permissions model (2026-07-17) — SHAPE parity with the callout
// cross-author capability landed in 9d8df592:
//   - contributors (editors) can SELECT any user's shapes (click + marquee),
//   - cross-author shape DELETES always plan the collaborator-cross-author
//     confirm-modal mode (never direct-fire),
//   - viewers stay fully blocked (ReadOnlyGate wall, not selection scope),
//   - owner behavior is unchanged,
//   - the eraser DELIBERATELY stays own-only (canModify) because it commits
//     destructively mid-gesture with no confirmation surface.
//
// Mix of pure-function tests (filterMarqueeHits, buildBulkDeletePlan) and
// source-assertion tests (useSVGInteraction.js / useAnnotationContextMenu.jsx
// are React-hook/JSX files node --test can't import — repo pattern per
// tests/annotationContextMenuCalloutDelete.test.mjs).

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok, match, doesNotMatch } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (p) => path.resolve(__dirname, '../../src', p);

const { filterMarqueeHits } = await import(SRC('utils/marqueeSelection.js'));
const { buildBulkDeletePlan } = await import(SRC('lib/collab/bulkDeletePlan.js'));
const { resolveReadOnlyReason } = await import(SRC('lib/collab/documentRole.js'));

const OWNER_ID = 'user-owner-uuid';
const COLLAB_ID = 'user-collab-uuid';
const OTHER_ID = 'user-other-uuid';

const anno = (id, authorId) => ({
  id,
  type: 'rect',
  meta: { authorId },
  data: { id, authorId, authorName: `Name-${authorId}` },
});

// --- Selection: marquee ---------------------------------------------------

test('locked model: contributor marquee keeps foreign-author shape hits (same-reference hot path)', () => {
  const annotations = {
    objects: [anno('a1', COLLAB_ID), anno('a2', OTHER_ID), anno('a3', OWNER_ID)],
  };
  const hits = [0, 1, 2];
  const out = filterMarqueeHits(hits, annotations, COLLAB_ID, OWNER_ID);
  strictEqual(out, hits, 'all hits pass for an authenticated contributor — same array reference returned');
});

test('locked model: owner marquee unchanged (same-reference passthrough)', () => {
  const annotations = { objects: [anno('a1', COLLAB_ID), anno('a2', OWNER_ID)] };
  const hits = [0, 1];
  strictEqual(filterMarqueeHits(hits, annotations, OWNER_ID, OWNER_ID), hits);
});

test('marquee still drops missing/stale indices', () => {
  const annotations = { objects: [anno('a1', OTHER_ID)] };
  deepStrictEqual(filterMarqueeHits([0, 5], annotations, COLLAB_ID, OWNER_ID), [0]);
});

// --- Delete: planner mode -------------------------------------------------

test('open model: contributor deleting a foreign shape plans a direct delete (no modal)', () => {
  const annotations = [anno('mine', COLLAB_ID), anno('theirs', OTHER_ID)];
  const plan = buildBulkDeletePlan({
    candidateIds: ['mine', 'theirs'],
    annotations,
    viewerId: COLLAB_ID,
    documentOwnerId: OWNER_ID,
  });
  // RULED 2026-09-28 owner: open editing + lock — cross-author deletes go straight through; byAuthor is informational.
  strictEqual(plan.mode, 'direct', 'cross-author delete is direct');
  deepStrictEqual(plan.ownIds, ['mine']);
  deepStrictEqual(plan.foreignIds, ['theirs']);
  ok(plan.byAuthor && plan.byAuthor[OTHER_ID]?.count === 1, 'byAuthor breakdown names the foreign author');
});

test('open model: owner deletes (own-only and cross-author) are direct', () => {
  const annotations = [anno('own', OWNER_ID), anno('foreign', OTHER_ID)];
  const ownOnly = buildBulkDeletePlan({
    candidateIds: ['own'],
    annotations,
    viewerId: OWNER_ID,
    documentOwnerId: OWNER_ID,
  });
  // RULED 2026-09-28 owner: open editing + lock — 'owner-own-only' collapsed into 'direct'.
  strictEqual(ownOnly.mode, 'direct', 'owner deleting own marks stays modal-free');
  const cross = buildBulkDeletePlan({
    candidateIds: ['own', 'foreign'],
    annotations,
    viewerId: OWNER_ID,
    documentOwnerId: OWNER_ID,
  });
  // RULED 2026-09-28 owner: open editing + lock — the owner cross-author breakdown modal is gone.
  strictEqual(cross.mode, 'direct', 'owner cross-author delete is direct');
});

// --- Viewer wall ----------------------------------------------------------

test('viewer role still resolves to the read-only wall (ReadOnlyGate blocks interaction before selection scope)', () => {
  strictEqual(resolveReadOnlyReason({ accessRevoked: false, docRole: 'viewer' }), 'viewer');
  strictEqual(resolveReadOnlyReason({ accessRevoked: false, docRole: 'editor' }), null);
  strictEqual(resolveReadOnlyReason({ accessRevoked: false, docRole: 'owner' }), null);
  // The wall's teeth: pointer events on the annotation SVG root are killed by
  // CSS while body[data-readonly] is set — pin the selector so a stylesheet
  // refactor can't silently reopen viewer interaction.
  const css = readFileSync(SRC('components/collab/ReadOnlyGate.css'), 'utf8');
  match(css, /body\[data-readonly="true"\] \.survey-pdfjs-page-div svg\[style\*="pointer-events: auto"\]\s*\{\s*pointer-events:\s*none !important;/);
});

// --- Source assertions: useSVGInteraction --------------------------------

const SVG_INTERACTION_SOURCE = readFileSync(SRC('hooks/useSVGInteraction.js'), 'utf8');

test('useSVGInteraction: click hit-test gate runs canSelect (contributors select foreign and locked shapes)', () => {
  const gate = SVG_INTERACTION_SOURCE.slice(
    SVG_INTERACTION_SOURCE.indexOf('const canSelectAnnotationByIndex'),
  );
  // RULED 2026-09-28 owner: open editing + lock — selection moved to canSelect, which also admits user-locked marks.
  match(gate.slice(0, 400), /return canSelect\(\{ annotation: a, viewerId, documentOwnerId \}\)/);
});

test('useSVGInteraction: deleteSelected admits every unlocked mark (own or foreign) and skips user-locked ones', () => {
  const start = SVG_INTERACTION_SOURCE.indexOf('const deleteSelected = useCallback');
  ok(start > -1, 'deleteSelected present');
  const body = SVG_INTERACTION_SOURCE.slice(start, start + 8000);
  // RULED 2026-09-28 owner: open editing + lock — the planner-only foreign lane is gone; the gate is the user lock + canModify.
  match(body, /if \(isUserLocked\(obj\)\) return false;/);
  match(body, /return canModify\(\{ annotation: obj, viewerId, documentOwnerId \}\);/);
  // The planner routing itself must still exist.
  match(body, /onRequestBulkDelete\(\{\s*candidateIds,\s*snapshotObjects,\s*pageNumber,\s*runDelete,\s*\}\)/);
});

// --- Source assertions: context menu --------------------------------------

const MENU_SOURCE = readFileSync(SRC('hooks/useAnnotationContextMenu.jsx'), 'utf8');

test('context menu: shape Delete items route through the bulk-delete planner bridge', () => {
  // Single-shape Delete and multi-select Delete both call requestBulkDelete
  // with the candidate/snapshot/runDelete contract.
  const calls = MENU_SOURCE.match(/requestBulkDelete\(\{/g) || [];
  ok(calls.length >= 2, `expected both shape Delete items to route through requestBulkDelete (found ${calls.length})`);
  match(MENU_SOURCE, /candidateIds: \[obj\.id\]/);
  // RULED 2026-09-28 owner: open editing + lock — the own/foreign split is gone; user-locked marks never reach the splice.
  match(MENU_SOURCE, /const canModifyObj = \(obj\) => \{\s*if \(!obj\) return false;\s*if \(isUserLocked\(obj\)\) return false;/);
  match(MENU_SOURCE, /\/\/ Open editing: any mark that is not user-locked\.\s*if \(!canModifyObj\(obj\)\) return;/);
});

// RULED 2026-09-28 owner: open editing + lock — title only: Cut takes anyone's unlocked marks (canModifyObj now admits them).
test('context menu: Cut goes through canModifyObj (any unlocked mark, user-locked marks stay)', () => {
  match(MENU_SOURCE, /if \(!canModifyObj\(obj\)\) return;/);
  match(MENU_SOURCE, /const ownAsc = sortedAsc\.filter\(\(idx\) => canModifyObj\(page\.objects\[idx\]\)\);/);
});

// --- Source assertion: eraser stays own-only (deliberate) ------------------

// RULED 2026-09-28 owner: open editing + lock — title only: canModify now admits foreign marks, so the eraser takes them and skips user-locked ones.
test('eraser: getEraseBlockReason gates on canModify (open editing; user-locked marks are skipped)', () => {
  const eraser = readFileSync(SRC('components/FabricEraserCanvas.jsx'), 'utf8');
  const start = eraser.indexOf('const getEraseBlockReason');
  ok(start > -1);
  const end = eraser.indexOf('\n  const ghostAtomicHits', start);
  ok(end > start);
  const body = eraser.slice(start, end);
  match(body, /!canModify\(\{/);
  doesNotMatch(body, /canDelete\(/);
});
