// One-import delete-grace window (blank-Row-ID plan slice 4, Amendment #5 —
// .planning/blank-rowid-matching-verdict.md). A previously-received marker whose
// row is missing from an imported save is no longer trashed on that SAME import:
// the first miss stamps a pending-delete mark on its device-local excelSync
// record; the next import either rebinds the row by any tier (mark cleared — no
// trash, no prompt, no duplicate) or still misses it (the shipped History +
// 30-day-tombstone trash path runs unchanged). Accepted behavior: deletes take
// effect one save later.
//
// These tests drive the REAL service + matcher + plans modules; the two-import
// scenarios replay the executors' exact triage order (apply-restamp → conflict
// clear → candidate-delete triage). The wiring inside PDFViewer.jsx cannot be
// unit-tested directly, so source-contract tripwires (same pattern as
// excelStaleGuardContracts.test.mjs) pin the load-bearing call sites.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  hasPendingDeleteMark,
  triageCandidateDelete,
  markPendingDelete,
  clearPendingDeleteMark
} from '../excelDeleteGrace.js';
import { buildScopeImportPlans, scopeKeyFor } from '../buildScopeImportPlans.js';
import { buildMarkerIdentityRecord } from '../excelIdentityRecord.js';
import { wasReceivedByExcel } from '../excelExportAck.js';

// ---------------------------------------------------------------------------
// Unit: the pure service
// ---------------------------------------------------------------------------

test('hasPendingDeleteMark: null / undefined / legacy records have no mark; either field counts', () => {
  assert.equal(hasPendingDeleteMark(null), false);
  assert.equal(hasPendingDeleteMark(undefined), false);
  assert.equal(hasPendingDeleteMark({}), false);
  assert.equal(hasPendingDeleteMark({ identityVectorFingerprint: 'abc' }), false); // legacy record
  assert.equal(hasPendingDeleteMark({ pendingDeleteSince: 123 }), true);
  assert.equal(hasPendingDeleteMark({ pendingDeleteSeq: 7 }), true);
  assert.equal(hasPendingDeleteMark({ pendingDeleteSince: 123, pendingDeleteSeq: 7 }), true);
});

test('triageCandidateDelete: first miss defers; a mark from an EARLIER ingest trashes', () => {
  assert.equal(triageCandidateDelete(null, { ingestSeq: 2000 }), 'defer');
  assert.equal(triageCandidateDelete({ identityVectorFingerprint: 'x' }, { ingestSeq: 2000 }), 'defer');
  assert.equal(
    triageCandidateDelete({ pendingDeleteSince: 999, pendingDeleteSeq: 1000 }, { ingestSeq: 2000 }),
    'trash'
  );
});

test('triageCandidateDelete: a mark stamped by THIS same ingest never counts as a prior miss', () => {
  assert.equal(
    triageCandidateDelete({ pendingDeleteSince: 999, pendingDeleteSeq: 2000 }, { ingestSeq: 2000 }),
    'defer'
  );
});

test('triageCandidateDelete: seq-less marks (older stampers) still count as a prior miss', () => {
  // Cannot prove the mark came from this same ingest → safe direction is the shipped
  // trash semantics on the SECOND observed miss, exactly as designed.
  assert.equal(triageCandidateDelete({ pendingDeleteSince: 999 }, { ingestSeq: 2000 }), 'trash');
  assert.equal(triageCandidateDelete({ pendingDeleteSince: 999, pendingDeleteSeq: 1000 }, {}), 'trash');
});

test('markPendingDelete: stamps both fields, preserves every other field, mutates nothing', () => {
  const legacy = { identityVectorFingerprint: 'abc', fieldFingerprints: { item: 'f1' } };
  const marked = markPendingDelete(legacy, { ingestSeq: 1000, now: 555 });
  assert.equal(marked.pendingDeleteSince, 555);
  assert.equal(marked.pendingDeleteSeq, 1000);
  assert.equal(marked.identityVectorFingerprint, 'abc');
  assert.deepEqual(marked.fieldFingerprints, { item: 'f1' });
  assert.equal(hasPendingDeleteMark(legacy), false, 'input record is not mutated');
});

test('markPendingDelete: an existing mark is preserved (the first-miss stamp keeps its meaning)', () => {
  const first = markPendingDelete({ identityVectorFingerprint: 'abc' }, { ingestSeq: 1000, now: 111 });
  const again = markPendingDelete(first, { ingestSeq: 2000, now: 222 });
  assert.equal(again, first, 'already-marked records pass through by reference');
  assert.equal(again.pendingDeleteSince, 111);
  assert.equal(again.pendingDeleteSeq, 1000);
});

test('markPendingDelete: invalid/absent ingestSeq omits the seq key entirely, never throws', () => {
  assert.equal('pendingDeleteSeq' in markPendingDelete({}, { now: 9 }), false);
  assert.equal('pendingDeleteSeq' in markPendingDelete({}, { ingestSeq: -5, now: 9 }), false);
  assert.equal('pendingDeleteSeq' in markPendingDelete({}, { ingestSeq: 1.5, now: 9 }), false);
  assert.equal(markPendingDelete(null, { ingestSeq: 7, now: 9 }).pendingDeleteSeq, 7);
  // pendingDeleteSince alone is a full-strength mark (detection + triage).
  const seqless = markPendingDelete({}, { ingestSeq: -1, now: 9 });
  assert.equal(seqless.pendingDeleteSince, 9);
  assert.equal(hasPendingDeleteMark(seqless), true);
  assert.equal(triageCandidateDelete(seqless, { ingestSeq: 2000 }), 'trash');
});

test('clearPendingDeleteMark: removes only the mark; unmarked/legacy records return the SAME reference', () => {
  const legacy = { identityVectorFingerprint: 'abc' };
  assert.equal(clearPendingDeleteMark(legacy), legacy, 'legacy records unaffected (same ref)');
  assert.equal(clearPendingDeleteMark(null), null);
  assert.equal(clearPendingDeleteMark(undefined), undefined);

  const marked = { identityVectorFingerprint: 'abc', pendingDeleteSince: 1, pendingDeleteSeq: 2 };
  const cleared = clearPendingDeleteMark(marked);
  assert.notEqual(cleared, marked);
  assert.equal(hasPendingDeleteMark(cleared), false);
  assert.equal(cleared.identityVectorFingerprint, 'abc');
  assert.equal('pendingDeleteSince' in cleared, false);
  assert.equal('pendingDeleteSeq' in cleared, false);
});

test('a fresh identity record (apply/export restamp) never carries a mark — restamp IS the clear', async () => {
  const record = await buildMarkerIdentityRecord({
    values: { changedBy: 'IC', changedDate: '6/8/2026', item: 'Door 12', entity: '', notes: '', answers: {} }
  });
  assert.equal(hasPendingDeleteMark(record), false);
  assert.equal('pendingDeleteSince' in record, false);
  assert.equal('pendingDeleteSeq' in record, false);
});

// ---------------------------------------------------------------------------
// Integration: two-import scenarios through the REAL matcher + plans pipeline,
// replaying the executors' triage order.
// ---------------------------------------------------------------------------

const KEY_ID = 'k1';
const SECRET = 'dGVzdC1zZWNyZXQtZm9yLWRlbGV0ZS1ncmFjZQ==';
const DOC = 'doc-grace:pdf-1';
const MODULE = 'mod-1';
const CATEGORY = 'cat-1';
const resolveSecret = (keyId) => (keyId === KEY_ID ? SECRET : null);

const templateToUse = {
  modules: [
    { id: MODULE, categories: [{ id: CATEGORY, checklist: [{ id: 'chk-1', text: 'Locked?' }] }] }
  ]
};
const headerRow = ['Row ID', 'Changed By', 'Changed Date', 'Item', 'Locked?', 'Entity', 'Notes'];
const rowValuesFor = ({ item, answer = 'Y', entity = 'North', notes = 'ok', changedBy = 'IC', changedDate = '6/8/2026' }) => ({
  changedBy, changedDate, item, entity, notes, answers: { 'chk-1': answer }
});
const excelRowFor = (token, { item, answer = 'Y', entity = 'North', notes = 'ok', changedBy = 'IC', changedDate = '6/8/2026' }) =>
  [token, changedBy, changedDate, item, answer, entity, notes];

async function receivedMarker(vals) {
  const record = await buildMarkerIdentityRecord({ values: rowValuesFor(vals), exportId: 'exp-1' });
  return {
    moduleId: MODULE, categoryId: CATEGORY, name: vals.item,
    pageNumber: null, bounds: null,
    exportedAt: '2026-06-08T00:00:00.000Z', // received by Excel → eligible for auto-trash
    excelSync: record
  };
}

// Replays the executor faithfully: apply → wholesale excelSync restamp from the
// decision's identityRecord; 'conflict' review → explicit mark clear; candidate
// deletes → received markers go through triageCandidateDelete (trash on a prior
// mark, mark on first miss), never-received stay review-only.
async function simulateImport({ surveyMarkers, dataRows, ingestSeq, appValuesByMarkerId = null }) {
  const plans = await buildScopeImportPlans({
    worksheetDataList: [{
      jsonData: [headerRow, ...dataRows],
      headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE
    }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret,
    appValuesByMarkerId, ingestSeq, logger: () => {}
  });
  const plan = plans.get(scopeKeyFor(MODULE, CATEGORY));
  const next = { ...surveyMarkers };
  const trashed = [];
  const created = [];
  const reviews = [];
  for (const [, d] of plan.byRowIndex) {
    if (d.action === 'apply' && d.markerId && next[d.markerId]) {
      next[d.markerId] = { ...next[d.markerId], excelSync: d.identityRecord };
    } else if (d.action === 'create') {
      created.push(d);
    } else if (d.action === 'review') {
      reviews.push(d);
      if (d.decision === 'conflict' && d.markerId && next[d.markerId]) {
        const cleared = clearPendingDeleteMark(next[d.markerId].excelSync);
        if (cleared !== next[d.markerId].excelSync) {
          next[d.markerId] = { ...next[d.markerId], excelSync: cleared };
        }
      }
    }
  }
  for (const markerId of plan.candidateDeletes) {
    const ann = next[markerId];
    if (!ann) continue;
    if (wasReceivedByExcel(ann)) {
      if (triageCandidateDelete(ann.excelSync, { ingestSeq }) === 'trash') {
        trashed.push(markerId);
        delete next[markerId];
      } else {
        next[markerId] = { ...ann, excelSync: markPendingDelete(ann.excelSync, { ingestSeq }) };
      }
    } else {
      reviews.push({ reason: 'candidate-delete', markerId });
    }
  }
  return { next, trashed, created, reviews, plan };
}

test('cut+save+paste+save: two imports, one continuous Survey Marker — nothing trashed, no duplicate', async () => {
  const vals = { item: 'Door 12' };
  let markers = { m1: await receivedMarker(vals) };

  // Save 1: the row was CUT (sheet saved without it).
  const a = await simulateImport({ surveyMarkers: markers, dataRows: [], ingestSeq: 1000 });
  assert.deepEqual(a.trashed, [], 'first miss never trashes');
  assert.deepEqual(a.created, []);
  assert.ok(a.next.m1, 'marker survives the first miss');
  assert.equal(hasPendingDeleteMark(a.next.m1.excelSync), true, 'first miss stamps the pending mark');
  markers = a.next;

  // Save 2: the row was PASTED BACK (blank Row ID — cut+paste of values only).
  const b = await simulateImport({ surveyMarkers: markers, dataRows: [excelRowFor('', vals)], ingestSeq: 2000 });
  assert.deepEqual(b.trashed, [], 'rebound marker is not trashed');
  assert.deepEqual(b.created, [], 'no duplicate Survey Marker is created');
  assert.deepEqual(b.plan.candidateDeletes, []);
  assert.ok(b.next.m1, 'one continuous marker across both imports');
  assert.equal(hasPendingDeleteMark(b.next.m1.excelSync), false, 'rebind cleared the mark via restamp');

  // Save 3: the row disappears again much later → grace restarts (fresh first miss).
  const c = await simulateImport({ surveyMarkers: b.next, dataRows: [], ingestSeq: 3000 });
  assert.deepEqual(c.trashed, [], 'a cleared mark means a later miss starts a FRESH grace window');
  assert.equal(hasPendingDeleteMark(c.next.m1.excelSync), true);
});

test('genuine delete across two imports: trashed on the second exactly as before', async () => {
  let markers = {
    m1: await receivedMarker({ item: 'Door 12' }),
    m2: await receivedMarker({ item: 'Window 3', notes: 'west wing' })
  };
  const keepRow = excelRowFor('', { item: 'Window 3', notes: 'west wing' });

  const a = await simulateImport({ surveyMarkers: markers, dataRows: [keepRow], ingestSeq: 1000 });
  assert.deepEqual(a.trashed, [], 'import 1: deferred, not trashed');
  assert.equal(hasPendingDeleteMark(a.next.m1.excelSync), true);
  assert.equal(hasPendingDeleteMark(a.next.m2.excelSync), false, 'matched marker carries no mark');

  const b = await simulateImport({ surveyMarkers: a.next, dataRows: [keepRow], ingestSeq: 2000 });
  assert.deepEqual(b.trashed, ['m1'], 'import 2: still unmatched → existing trash path');
  assert.equal(b.next.m1, undefined);
  assert.ok(b.next.m2, 'the matched marker is untouched');
});

test('pending mark cleared on a conflict rebind (both-sides edit while marked)', async () => {
  const baseVals = { item: 'Door 12', notes: '' };
  let markers = { m1: await receivedMarker(baseVals) };

  // Import 1: row missing → mark stamped.
  const a = await simulateImport({ surveyMarkers: markers, dataRows: [], ingestSeq: 1000 });
  assert.equal(hasPendingDeleteMark(a.next.m1.excelSync), true);

  // Import 2: the row is back, but notes were edited on BOTH sides since the baseline
  // (app: 'car', Excel: 'not car') → Tier-4 recovery + conflict-guard downgrade.
  const b = await simulateImport({
    surveyMarkers: a.next,
    dataRows: [excelRowFor('', { ...baseVals, notes: 'not car' })],
    ingestSeq: 2000,
    appValuesByMarkerId: { m1: rowValuesFor({ ...baseVals, notes: 'car' }) }
  });
  const conflict = b.reviews.find((r) => r.decision === 'conflict');
  assert.ok(conflict, 'both-sides edit reaches the existing conflict review');
  assert.equal(conflict.markerId, 'm1');
  assert.deepEqual(b.trashed, [], 'a conflict rebind never trashes');
  assert.deepEqual(b.created, [], 'and never duplicates');
  assert.ok(b.next.m1);
  assert.equal(hasPendingDeleteMark(b.next.m1.excelSync), false, 'conflict rebind cleared the mark');
});

test('never-received markers keep their review-only protection (no mark, no trash)', async () => {
  const marker = await receivedMarker({ item: 'App Only' });
  delete marker.exportedAt; // Excel never received it
  let markers = { m1: marker };

  const a = await simulateImport({ surveyMarkers: markers, dataRows: [], ingestSeq: 1000 });
  assert.deepEqual(a.trashed, []);
  assert.ok(a.reviews.some((r) => r.reason === 'candidate-delete' && r.markerId === 'm1'));
  assert.equal(hasPendingDeleteMark(a.next.m1.excelSync), false, 'review-only path stamps nothing');

  const b = await simulateImport({ surveyMarkers: a.next, dataRows: [], ingestSeq: 2000 });
  assert.deepEqual(b.trashed, [], 'still review-only on every later import');
  assert.ok(b.next.m1);
});

test('review-shielded candidates keep their shielding; an existing mark neither trashes nor clears', async () => {
  // One blank row overlapping TWO non-identical leftovers → ambiguous-identity review;
  // both candidates are shielded from candidateDeletes (existing matcher behavior).
  const m1 = await receivedMarker({ item: 'Door 12', notes: 'alpha' });
  const m2 = await receivedMarker({ item: 'Door 12', notes: 'beta' });
  m1.excelSync = markPendingDelete(m1.excelSync, { ingestSeq: 500, now: 500 }); // marked on a prior import
  const markers = { m1, m2 };

  const a = await simulateImport({
    surveyMarkers: markers,
    dataRows: [excelRowFor('', { item: 'Door 12', notes: 'gamma' })],
    ingestSeq: 1000
  });
  assert.ok(a.reviews.some((r) => r.decision === 'ambiguous-identity'));
  assert.deepEqual(a.plan.candidateDeletes, [], 'shielding intact — never a delete candidate');
  assert.deepEqual(a.trashed, []);
  assert.ok(a.next.m1 && a.next.m2);
  assert.equal(hasPendingDeleteMark(a.next.m1.excelSync), true, 'shield is not a match: mark is kept, not cleared');
});

test('legacy records without the new fields are unaffected until a miss actually happens', async () => {
  const vals = { item: 'Door 12' };
  const markers = { m1: await receivedMarker(vals) }; // record has no pendingDelete fields
  const a = await simulateImport({ surveyMarkers: markers, dataRows: [excelRowFor('', vals)], ingestSeq: 1000 });
  assert.deepEqual(a.trashed, []);
  assert.deepEqual(a.created, []);
  assert.equal(hasPendingDeleteMark(a.next.m1.excelSync), false);
  assert.equal('pendingDeleteSince' in a.next.m1.excelSync, false, 'no grace fields appear on normal syncs');
});

// ---------------------------------------------------------------------------
// Source contracts: the PDFViewer wiring (both executors, symmetric).
// ---------------------------------------------------------------------------

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = readFileSync(join(root, 'src', 'PDFViewer.jsx'), 'utf8');

test('contract: both candidate-delete sites triage through the grace window', () => {
  const triages = src.match(/triageCandidateDelete\(ann\.excelSync, \{ ingestSeq: importIngestSeq \}\) === 'trash'/g) || [];
  assert.ok(triages.length >= 2, `expected both executors to triage, found ${triages.length}`);
  const marks = src.match(/markPendingDelete\(ann\.excelSync, \{ ingestSeq: importIngestSeq \}\)/g) || [];
  assert.ok(marks.length >= 2, `expected both executors to stamp the mark, found ${marks.length}`);
});

test('contract: both executors clear the mark on a conflict rebind', () => {
  const clears = src.match(/clearPendingDeleteMark\(newSurveyMarkers\[decision\.markerId\]\.excelSync\)/g) || [];
  assert.ok(clears.length >= 2, `expected both executors to clear on conflict, found ${clears.length}`);
});

test('contract: one ingest sequence per import feeds both the plans and the grace triage', () => {
  const seqs = src.match(/const importIngestSeq = Date\.now\(\);/g) || [];
  assert.ok(seqs.length >= 2, `expected both executors to take one wall-clock reading, found ${seqs.length}`);
  const threaded = src.match(/ingestSeq: importIngestSeq/g) || [];
  assert.ok(threaded.length >= 2, 'importIngestSeq must be passed to buildScopeImportPlans in both executors');
});

test('contract: the existing protections still gate the trash path', () => {
  // recency + received-only gates wrap the grace triage (manual executor)
  assert.match(src, /!recencyDeletesDisabled && wasReceivedByExcel\(ann\)/);
  // never-received candidates stay review-only at both sites
  const reviewOnly = src.match(/reason: 'candidate-delete', markerId \}\);/g) || [];
  assert.ok(reviewOnly.length >= 2, 'review-only branch must remain at both sites');
});
