// excelScenarioGaps.test.mjs — BL-13: the verified-missing scenario compositions.
//
// The BL-13 matrix (copied / renamed / deleted / moved × token / blank-Row-ID ×
// open/closed × storage surface) is mostly covered piecemeal — the full map lives
// in docs/excel-sync-scenario-coverage.md. This file adds ONLY the compositions
// no existing test drives, all at the buildScopeImportPlans layer (the real entry
// point PDFViewer's import executors call), with the delete-grace pair where the
// scenario crosses into deletion:
//   G1 — copied row at PLAN level (matcher-level existed: rowImportMatcher.test.mjs)
//   G2 — blank-Row-ID rename at PLAN level (matcher-level existed:
//        rowImportMatcherFieldOverlap.test.mjs)
//   G3 — cross-sheet move + genuine delete + never-received marker in ONE import
//        (shield selectivity composition; single behaviors existed in
//        sheetRowPosition.test.mjs + excelDeleteGrace.test.mjs)
//
// Deliberately NOT here: paste-above (contract drift — PLAN.md decision #3 says
// review, the matcher implements first-row-wins with an in-code accepted-tradeoff
// note; awaiting Isaiah's sign-off, see the coverage index); the writeback drain
// matrix (tests/excelLiveSyncWritebackIntegration.test.mjs owns it).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildScopeImportPlans, scopeKeyFor } from '../buildScopeImportPlans.js';
import { buildMarkerIdentityRecord } from '../excelIdentityRecord.js';
import { generateRowIdToken } from '../rowIdToken.js';
import { wasReceivedByExcel } from '../excelExportAck.js';
import {
  hasPendingDeleteMark,
  triageCandidateDelete,
  markPendingDelete
} from '../excelDeleteGrace.js';

const KEY_ID = 'k1';
const SECRET = 'dGVzdC1zZWNyZXQtZm9yLXNjZW5hcmlvLXN1aXRl';
const DOC = 'doc-scenario-gaps:pdf-1';
const MODULE = 'mod-1';
const CAT_A = 'cat-a';
const CAT_B = 'cat-b';
const SCOPE_A = `${MODULE}:${CAT_A}`;
const resolveSecret = (keyId) => (keyId === KEY_ID ? SECRET : null);

const templateToUse = {
  modules: [{ id: MODULE, categories: [{ id: CAT_A, checklist: [] }, { id: CAT_B, checklist: [] }] }]
};
const HEADER = ['Row ID', 'Changed By', 'Changed Date', 'Item', 'Entity', 'Notes'];

const vals = (item, notes = '', entity = '') =>
  ({ changedBy: 'IC', changedDate: '6/10/2026', item, entity, notes, answers: {} });

// sheetRowNumber rides as a non-index property, exactly as the exceljs parse
// loops attach it (array index ≠ sheet row).
const excelRow = (rowIdCell, v, sheetRowNumber = null) => {
  const r = [rowIdCell, v.changedBy, v.changedDate, v.item, v.entity, v.notes];
  if (sheetRowNumber != null) r.sheetRowNumber = sheetRowNumber;
  return r;
};

const markerFor = async (v, { categoryId = CAT_A, exportedAt = null, lineage = null } = {}) => {
  const excelSync = await buildMarkerIdentityRecord({ values: v, origin: 'import' });
  if (lineage) Object.assign(excelSync, lineage); // copyOfMarkerId/copyOrdinal live on excelSync
  const m = { moduleId: MODULE, categoryId, name: v.item, excelSync };
  if (exportedAt) m.exportedAt = exportedAt;
  return m;
};

const scopeSheet = (categoryId, dataRows) => ({
  jsonData: [HEADER, ...dataRows],
  headerRow: HEADER,
  matchedCategory: { id: categoryId },
  matchedModuleId: MODULE
});

const runPlans = (worksheetDataList, surveyMarkers, extra = {}) =>
  buildScopeImportPlans({
    worksheetDataList, surveyMarkers, templateToUse,
    documentId: DOC, resolveSecret, logger: () => {}, ...extra
  });

const tokenFor = (markerId, scopeId = SCOPE_A) =>
  generateRowIdToken({ keyId: KEY_ID, secret: SECRET, documentId: DOC, scopeId, markerId });

// ---------------------------------------------------------------------------
// G1 — copied row at plan level (PLAN.md Amendment 2026-06-08(b), decision #3:
// copy-below auto-resolves to a NEW item by binding+position; idempotent re-save)
// ---------------------------------------------------------------------------

test('G1: copy-below at plan level — original matches, copy becomes a new item with lineage; re-save is idempotent', async () => {
  const v = vals('Door 12', 'payload');
  const tok = await tokenFor('m1');

  // Import 1: the user copied the row below the original (same token twice).
  const first = await runPlans(
    [scopeSheet(CAT_A, [excelRow(tok, v, 2), excelRow(tok, v, 3)])],
    { m1: await markerFor(v) }
  );
  const p1 = first.get(scopeKeyFor(MODULE, CAT_A));
  assert.equal(p1.byRowIndex.get(1).decision, 'match');
  assert.equal(p1.byRowIndex.get(1).markerId, 'm1');
  const copy = p1.byRowIndex.get(2);
  assert.equal(copy.decision, 'copy-new');
  assert.equal(copy.action, 'create');
  assert.equal(copy.copyOfMarkerId, 'm1', 'lineage only — token mint/writeback is a different seam');
  assert.equal(copy.copyOrdinal, 1);
  assert.equal(copy.identityRecord.copyOfMarkerId, 'm1', 'lineage is stamped into the created identity record');
  assert.deepEqual(p1.candidateDeletes, [], 'a copy never endangers the original');

  // Import 2: the copy became marker m2 (lineage remembered on excelSync) and the
  // sheet is re-saved unchanged — the copy applies to ITS marker, no new twin.
  const second = await runPlans(
    [scopeSheet(CAT_A, [excelRow(tok, v, 2), excelRow(tok, v, 3)])],
    {
      m1: await markerFor(v),
      m2: await markerFor(v, { lineage: { copyOfMarkerId: 'm1', copyOrdinal: 1 } })
    }
  );
  const p2 = second.get(scopeKeyFor(MODULE, CAT_A));
  assert.equal(p2.byRowIndex.get(1).decision, 'match');
  assert.equal(p2.byRowIndex.get(2).decision, 'copy-existing');
  assert.equal(p2.byRowIndex.get(2).action, 'apply');
  assert.equal(p2.byRowIndex.get(2).markerId, 'm2', 'recovered, not re-created');
  assert.deepEqual(p2.candidateDeletes, []);
});

// ---------------------------------------------------------------------------
// G2 — blank-Row-ID rename at plan level (PLAN.md Amendment #10: rename = same
// marker, attribute update; Tier-4 field-overlap recovery when no token exists)
// ---------------------------------------------------------------------------

test('G2: blank-Row-ID rename at plan level — field-overlap recovers the SAME marker, no duplicate, no delete', async () => {
  const baseline = vals('Door 12', 'unique inspection payload', 'North');
  const renamed = vals('Door 12 RENAMED', 'unique inspection payload', 'North');

  const plans = await runPlans(
    [scopeSheet(CAT_A, [excelRow('', renamed, 2)])],
    { m1: await markerFor(baseline) }
  );
  const plan = plans.get(scopeKeyFor(MODULE, CAT_A));
  const d = plan.byRowIndex.get(1);
  assert.equal(d.decision, 'missing-rowid');
  assert.equal(d.action, 'apply');
  assert.equal(d.markerId, 'm1', 'the rename lands on the SAME Survey Marker');
  assert.equal(d.recoveredBy, 'field-overlap', 'proves Tier-4 did the pairing (item changed → no exact fingerprint)');
  assert.deepEqual(plan.candidateDeletes, [], 'the renamed original is never a delete candidate');
});

// ---------------------------------------------------------------------------
// G3 — cross-sheet move + genuine delete + never-received marker in ONE import.
// Pins the IMPLEMENTED shield/degrade behavior (HANDOFF-excel-sync-next.md
// cross-scope reconciliation; the handoff's word "move" is ambiguous — what is
// implemented and locked by sheetRowPosition.test.mjs is: shield from wrong
// local pairing, restorable delete+create, deferred via the grace window) and
// proves the shield is per-fingerprint, not a blanket delete suppression.
// Delete authority: PLAN.md Amendment #1 (only received markers may ever trash);
// grace: HANDOFF commit 131d63d9 (first miss marks, second miss trashes).
// ---------------------------------------------------------------------------

test('G3: move + genuine delete + never-received in one import — shield is per-fingerprint, gate + grace protect correctly', async () => {
  const movedVals = vals('Cut Row', 'moved payload');
  const surveyMarkers = {
    // mX: received marker whose row was CUT from scope A and PASTED into scope B.
    mX: await markerFor(movedVals, { exportedAt: '2026-06-09T00:00:00.000Z' }),
    // mY: received marker genuinely deleted (absent from BOTH scopes).
    mY: await markerFor(vals('Window 3', 'gone'), { exportedAt: '2026-06-09T00:00:00.000Z' }),
    // mZ: never received by Excel — a missing row must NEVER trash it (Amendment #1).
    mZ: await markerFor(vals('Hatch 9', 'never exported'))
  };
  // Scope A also has a DIFFERENT blank row sharing mX's Item — without the
  // cross-scope shield it would wrongly pair (steal the moved marker).
  const sheetA = [excelRow('', vals('Cut Row', 'different payload', 'South'), 2)];
  const sheetB = [excelRow('', movedVals, 2)];

  const plans = await runPlans(
    [scopeSheet(CAT_A, sheetA), scopeSheet(CAT_B, sheetB)],
    surveyMarkers,
    { ingestSeq: 1000 }
  );
  const planA = plans.get(scopeKeyFor(MODULE, CAT_A));
  const planB = plans.get(scopeKeyFor(MODULE, CAT_B));

  // Shield selectivity: the overlapping local row must NOT steal the moved marker…
  assert.equal(planA.byRowIndex.get(1).decision, 'new-row',
    'cross-scope shield blocks the wrong local graft');
  // …while the pasted row creates fresh in its new scope (the implemented degrade).
  assert.equal(planB.byRowIndex.get(1).decision, 'new-row');
  // All three absent markers are candidate deletes at the PLAN layer — authority
  // is decided downstream by the received gate + grace triage, not the planner.
  assert.deepEqual([...planA.candidateDeletes].sort(), ['mX', 'mY', 'mZ']);

  // The received gate BEFORE triage (the executor pattern, mirrored from
  // excelDeleteGrace.test.mjs's simulateImport): never-received → review only.
  const reviews = [];
  let next = { ...surveyMarkers };
  for (const markerId of planA.candidateDeletes) {
    const ann = next[markerId];
    if (!wasReceivedByExcel(ann)) { reviews.push(markerId); continue; }
    if (triageCandidateDelete(ann.excelSync, { ingestSeq: 1000 }) === 'trash') {
      delete next[markerId];
    } else {
      next[markerId] = { ...ann, excelSync: markPendingDelete(ann.excelSync, { ingestSeq: 1000 }) };
    }
  }
  assert.deepEqual(reviews, ['mZ'], 'never-received is shielded by the wasReceivedByExcel gate, permanently');
  assert.ok(next.mX && next.mY, 'first miss never trashes — the grace window defers');
  assert.equal(hasPendingDeleteMark(next.mX.excelSync), true, 'the moved marker is marked, restorable, not trashed');
  assert.equal(hasPendingDeleteMark(next.mY.excelSync), true, 'the genuine delete waits for its second miss');
  assert.equal(hasPendingDeleteMark(next.mZ.excelSync ?? {}), false, 'never-received is never even marked');
});
