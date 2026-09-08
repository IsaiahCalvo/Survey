// tests/phase35/contributorCrossAuthorShapes.test.mjs
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

test('locked model: contributor deleting a foreign shape plans collaborator-cross-author (the modal mode)', () => {
  const annotations = [anno('mine', COLLAB_ID), anno('theirs', OTHER_ID)];
  const plan = buildBulkDeletePlan({
    candidateIds: ['mine', 'theirs'],
    annotations,
    viewerId: COLLAB_ID,
    documentOwnerId: OWNER_ID,
  });
  strictEqual(plan.mode, 'collaborator-cross-author', 'cross-author delete must land in the confirm-modal mode');
  deepStrictEqual(plan.ownIds, ['mine']);
  deepStrictEqual(plan.foreignIds, ['theirs']);
  ok(plan.byAuthor && plan.byAuthor[OTHER_ID]?.count === 1, 'byAuthor breakdown names the foreign author');
});

test('locked model: owner delete modes are unchanged', () => {
  const annotations = [anno('own', OWNER_ID), anno('foreign', OTHER_ID)];
  const ownOnly = buildBulkDeletePlan({
    candidateIds: ['own'],
    annotations,
    viewerId: OWNER_ID,
    documentOwnerId: OWNER_ID,
  });
  strictEqual(ownOnly.mode, 'owner-own-only', 'owner deleting own marks stays modal-free');
  const cross = buildBulkDeletePlan({
    candidateIds: ['own', 'foreign'],
    annotations,
    viewerId: OWNER_ID,
    documentOwnerId: OWNER_ID,
  });
  strictEqual(cross.mode, 'owner-cross-author', 'owner cross-author breakdown modal unchanged');
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

test('useSVGInteraction: click hit-test gate runs canDelete (contributors select foreign shapes)', () => {
  const gate = SVG_INTERACTION_SOURCE.slice(
    SVG_INTERACTION_SOURCE.indexOf('const canSelectAnnotationByIndex'),
  );
  match(gate.slice(0, 500), /return canDelete\(\{ annotation: a, viewerId, documentOwnerId, localDocumentContext \}\)/);
});

test('useSVGInteraction: deleteSelected admits foreign ids ONLY through the planner (modal path), never the direct-fire fallbacks', () => {
  const start = SVG_INTERACTION_SOURCE.indexOf('const deleteSelected = useCallback');
  ok(start > -1, 'deleteSelected present');
  const body = SVG_INTERACTION_SOURCE.slice(start, start + 8000);
  // Own marks stay eligible everywhere.
  match(body, /if \(canModify\(\{ annotation: obj, viewerId, documentOwnerId, localDocumentContext \}\)\) return true;/);
  // Foreign marks require the planner AND a stable id, then pass canDelete —
  // guaranteeing the collaborator-cross-author confirm modal is unavoidable.
  match(body, /return plannerAvailable\s*&& obj\.id != null\s*&& canDelete\(\{ annotation: obj, viewerId, documentOwnerId, localDocumentContext \}\);/);
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
  // Foreign marks can never fall through to the ungated splice.
  match(MENU_SOURCE, /if \(!own && !canPlanForeignDelete\(obj\)\) return;/);
});

test('context menu: Cut stays own-marks-only (no unconfirmed cross-author destruction)', () => {
  match(MENU_SOURCE, /if \(!canModifyObj\(obj\)\) return;/);
  match(MENU_SOURCE, /const ownAsc = sortedAsc\.filter\(\(idx\) => canModifyObj\(page\.objects\[idx\]\)\);/);
});

// --- Source assertion: eraser stays own-only (deliberate) ------------------

test('eraser: getEraseBlockReason deliberately stays on canModify (no unconfirmed cross-author erase)', () => {
  const eraser = readFileSync(SRC('components/FabricEraserCanvas.jsx'), 'utf8');
  const start = eraser.indexOf('const getEraseBlockReason');
  ok(start > -1);
  const end = eraser.indexOf('\n  const ghostAtomicHits', start);
  ok(end > start);
  const body = eraser.slice(start, end);
  match(body, /!canModify\(\{/);
  doesNotMatch(body, /canDelete\(/);
});
