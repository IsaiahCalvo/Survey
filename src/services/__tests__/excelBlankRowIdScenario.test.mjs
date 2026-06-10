// Integration scenario suite for the blank-Row-ID matching workstream
// (.planning/blank-rowid-matching-verdict.md — AMENDMENTS section GOVERNING).
//
// Unlike the matcher-level suites (rowImportMatcherFieldOverlap / Positional),
// these tests drive rowImportMatcher AND buildScopeImportPlans TOGETHER through
// the real plan builder — the same entry point PDFViewer's import executors call —
// and assert at the PLAN level: decisions, actions, conflictFields,
// excelChangedFields, candidateDeletes.
//
// Covered, in order:
//   1. the verbatim live-bug steps (2026-06-09): blank-ID row, note edited BOTH
//      sides with only one shared identity field → review, empty candidateDeletes
//      (previously: auto-paired by one field or created a duplicate/delete candidate);
//   2. Variant C: same shape but the original was EXPORTED (exportedAt stamped) —
//      once paired it must NOT be delete-eligible (previously: silent auto-trash);
//   3. Isaiah's five verbatim examples (EX1-EX5) at plan level;
//   4. a mixed population (token rows + blanks, one moved + one edited) asserting
//      strict tier precedence: Row-ID token > exact fingerprint > position/overlap.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildScopeImportPlans, scopeKeyFor } from '../buildScopeImportPlans.js';
import { buildMarkerIdentityRecord } from '../excelIdentityRecord.js';
import { generateRowIdToken } from '../rowIdToken.js';
import { wasReceivedByExcel } from '../excelExportAck.js';

const KEY_ID = 'k1';
const SECRET = 'dGVzdC1zZWNyZXQtZm9yLXNjZW5hcmlvLXN1aXRl';
const DOC = 'doc-scenarios:pdf-1';
const MODULE = 'mod-1';
const CATEGORY = 'cat-1';
const SCOPE = `${MODULE}:${CATEGORY}`;
const SCOPE_KEY = scopeKeyFor(MODULE, CATEGORY);
const SEQ = 100; // the ONE prior-ingest snapshot all positional stamps come from
const resolveSecret = (keyId) => (keyId === KEY_ID ? SECRET : null);

const templateToUse = { modules: [{ id: MODULE, categories: [{ id: CATEGORY, checklist: [] }] }] };
const HEADER = ['Row ID', 'Changed By', 'Changed Date', 'Item', 'Entity', 'Notes'];

// Visible row values — the same shape export writes and import reads back.
const vals = (item, notes = '') =>
  ({ changedBy: 'IC', changedDate: '6/9/2026', item, entity: '', notes, answers: {} });

// One Excel data row. sheetRowNumber rides as a non-index property on the row
// array, exactly how the exceljs parse loops attach it (array index ≠ sheet row).
const excelRow = (rowIdCell, v, sheetRowNumber = null) => {
  const r = [rowIdCell, v.changedBy, v.changedDate, v.item, v.entity, v.notes];
  if (sheetRowNumber != null) r.sheetRowNumber = sheetRowNumber;
  return r;
};

// A stored Survey Marker whose excelSync baseline was stamped from `v` at a prior
// import — optionally with the device-local positional stamps (slot + ingest seq).
const markerFor = async (v, { slot = null, seq = null, exportedAt = null } = {}) => {
  const excelSync = await buildMarkerIdentityRecord({
    values: v, origin: 'import', lastSeenRowNumber: slot, lastIngestSeq: seq
  });
  const m = { moduleId: MODULE, categoryId: CATEGORY, name: v.item, excelSync };
  if (exportedAt) m.exportedAt = exportedAt;
  return m;
};

const runPlan = async ({ dataRows, surveyMarkers, appValuesByMarkerId = null }) => {
  const plans = await buildScopeImportPlans({
    worksheetDataList: [{
      jsonData: [HEADER, ...dataRows],
      headerRow: HEADER,
      matchedCategory: { id: CATEGORY },
      matchedModuleId: MODULE
    }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret,
    appValuesByMarkerId, logger: () => {}
  });
  const plan = plans.get(SCOPE_KEY);
  assert.ok(plan, 'scope has a plan');
  return plan;
};

const decisionsOf = (plan) => [...plan.byRowIndex.values()];

// ---------------------------------------------------------------------------
// 1. The verbatim bug steps (live repro 2026-06-09), end-to-end at plan level
// ---------------------------------------------------------------------------

test('BUG STEPS: blank-ID row, note edited BOTH sides with one-field overlap → review; empty candidateDeletes', async () => {
  // Step 1: import created m1 from [item="test", notes blank, no Row ID] and
  // stamped excelSync from those exact values.
  const baseline = vals('test', '');
  const surveyMarkers = { m1: await markerFor(baseline) };
  // Step 2: the user edits the marker's note IN THE APP to "car" (the baseline is
  // NOT restamped by app edits — only import-apply/create or export restamp it).
  const appValuesByMarkerId = { m1: vals('test', 'car') };
  // Steps 3/4: the Excel row's note is edited to "not car" (still no Row ID) and
  // the file is saved/imported.
  const plan = await runPlan({
    dataRows: [excelRow('', vals('test', 'not car'))],
    surveyMarkers, appValuesByMarkerId
  });

  const ds = decisionsOf(plan);
  assert.equal(ds.length, 1, 'exactly one decision — no duplicate create');
  const d = plan.byRowIndex.get(1);
  assert.equal(d.decision, 'ambiguous-identity', 'one shared identity field is review, not auto-pair');
  assert.equal(d.action, 'review');
  assert.deepEqual(d.candidateMarkerIds, ['m1']);
  assert.deepEqual(plan.candidateDeletes, [], 'the possible original stays shielded from deletes');
});

// ---------------------------------------------------------------------------
// 2. Variant C: the exported-marker variant — paired ⇒ never delete-eligible
// ---------------------------------------------------------------------------

test('VARIANT C: exported original with one-field overlap is review-shielded (no auto-trash)', async () => {
  const baseline = vals('test', '');
  const m1 = await markerFor(baseline, { exportedAt: '2026-06-08T00:00:00.000Z' });
  assert.equal(wasReceivedByExcel(m1), true,
    'sanity: this marker WOULD be auto-trashed by the executor if it ever reached candidateDeletes');

  const plan = await runPlan({
    dataRows: [excelRow('', vals('test', 'not car'))],
    surveyMarkers: { m1 },
    appValuesByMarkerId: { m1: vals('test', 'car') }
  });

  const d = plan.byRowIndex.get(1);
  assert.equal(d.decision, 'ambiguous-identity');
  assert.deepEqual(d.candidateMarkerIds, ['m1']);
  assert.deepEqual(plan.candidateDeletes, [],
    'review-shielded marker never enters candidateDeletes — the Variant-C silent auto-trash is unreachable');
});

// ---------------------------------------------------------------------------
// 3. Isaiah's five verbatim examples, at plan level
// ---------------------------------------------------------------------------

test('EX1 (plan level): row7 test/blank edited to test/"not car" in Excel only → one apply with excelChangedFields=[notes]', async () => {
  const baseline = vals('test', '');
  const surveyMarkers = { m1: await markerFor(baseline, { slot: 7, seq: SEQ }) };
  const plan = await runPlan({
    dataRows: [excelRow('', vals('test', 'not car'), 7)],
    surveyMarkers,
    appValuesByMarkerId: { m1: baseline } // app untouched → one-sided edit, no conflict
  });

  const d = plan.byRowIndex.get(1);
  assert.equal(d.decision, 'missing-rowid');
  assert.equal(d.action, 'apply');
  assert.equal(d.markerId, 'm1');
  assert.deepEqual(d.conflictFields, undefined, 'one-sided edit never conflicts');
  assert.deepEqual(d.excelChangedFields, ['notes'], '3-way merge whitelist: Excel may write only what Excel changed');
  assert.deepEqual(plan.candidateDeletes, []);
});

test('EX2 (plan level): row7 "test" moved to row2 → exact-tier pairing; position is irrelevant to an exact match', async () => {
  const baseline = vals('test', '');
  const surveyMarkers = { m1: await markerFor(baseline, { slot: 7, seq: SEQ }) };
  const plan = await runPlan({ dataRows: [excelRow('', baseline, 2)], surveyMarkers });

  const d = plan.byRowIndex.get(1);
  assert.equal(d.decision, 'missing-rowid');
  assert.equal(d.action, 'apply');
  assert.equal(d.markerId, 'm1');
  assert.equal(d.recoveredBy, undefined, 'exact tier, not positional');
  assert.deepEqual(plan.candidateDeletes, []);
});

test('EX3 (plan level): identical rows 5,7 now at 5,2 → same-slot first then elimination; zero creates, zero reviews', async () => {
  const twin = vals('test', '');
  const surveyMarkers = {
    m5: await markerFor(twin, { slot: 5, seq: SEQ }),
    m7: await markerFor(twin, { slot: 7, seq: SEQ })
  };
  const plan = await runPlan({
    dataRows: [excelRow('', twin, 2), excelRow('', twin, 5)], // sheet order
    surveyMarkers
  });

  const ds = decisionsOf(plan);
  assert.equal(ds.length, 2);
  assert.ok(ds.every((d) => d.decision === 'missing-rowid' && d.action === 'apply'),
    'Amendment #4: identical twins pair silently — zero creates, zero reviews');
  assert.equal(plan.byRowIndex.get(2).markerId, 'm5', 'row still at sheet 5 keeps the slot-5 marker');
  assert.equal(plan.byRowIndex.get(1).markerId, 'm7', 'row at sheet 2 takes the remaining twin');
  assert.deepEqual(plan.candidateDeletes, []);
});

test('EX4 (plan level): rows 5,7 test/blank → row5 edited to "abc" + row2 blank → 5→5 positional, 7→2 exact residue', async () => {
  const base = vals('test', '');
  const surveyMarkers = {
    m5: await markerFor(base, { slot: 5, seq: SEQ }),
    m7: await markerFor(base, { slot: 7, seq: SEQ })
  };
  const plan = await runPlan({
    dataRows: [excelRow('', vals('test', ''), 2), excelRow('', vals('test', 'abc'), 5)],
    surveyMarkers
  });

  const ds = decisionsOf(plan);
  assert.equal(ds.length, 2);
  assert.ok(ds.every((d) => d.decision === 'missing-rowid' && d.action === 'apply'));
  assert.equal(plan.byRowIndex.get(2).markerId, 'm5', 'edited row at slot 5 takes the slot-5 marker');
  assert.equal(plan.byRowIndex.get(2).recoveredBy, 'positional');
  assert.equal(plan.byRowIndex.get(1).markerId, 'm7', 'unchanged row takes the remaining exact twin');
  assert.equal(plan.byRowIndex.get(1).recoveredBy, undefined);
  assert.deepEqual(plan.candidateDeletes, []);
});

test('EX5 (plan level): identical rows 5,7 now at 1,2 → order-preserving pairing, zero creates, zero reviews', async () => {
  const twin = vals('Twin', 'same');
  const surveyMarkers = {
    mA: await markerFor(twin, { slot: 5, seq: SEQ }),
    mB: await markerFor(twin, { slot: 7, seq: SEQ })
  };
  const plan = await runPlan({
    dataRows: [excelRow('', twin, 1), excelRow('', twin, 2)],
    surveyMarkers
  });

  const ds = decisionsOf(plan);
  assert.equal(ds.length, 2);
  assert.ok(ds.every((d) => d.decision === 'missing-rowid' && d.action === 'apply'));
  assert.equal(plan.byRowIndex.get(1).markerId, 'mA', 'relative sheet order preserved');
  assert.equal(plan.byRowIndex.get(2).markerId, 'mB');
  assert.deepEqual(plan.candidateDeletes, []);
});

// ---------------------------------------------------------------------------
// 4. Mixed population — strict tier precedence end-to-end
// ---------------------------------------------------------------------------

test('MIXED: token + blank rows, one moved + one edited → token > exact > position/overlap; zero creates, zero reviews', async () => {
  // Stored layout at the last ingested save:
  //   slot 2: mA "Alpha"  (carries a Row-ID token in the sheet)
  //   slot 5: mB "Beta"
  //   slot 7: mC "Gamma"
  const aVals = vals('Alpha', 'a');
  const bVals = vals('Beta', 'b');
  const cVals = vals('Gamma', 'c');
  const surveyMarkers = {
    mA: await markerFor(aVals, { slot: 2, seq: SEQ }),
    mB: await markerFor(bVals, { slot: 5, seq: SEQ }),
    mC: await markerFor(cVals, { slot: 7, seq: SEQ })
  };
  const token = await generateRowIdToken({
    keyId: KEY_ID, secret: SECRET, documentId: DOC, scopeId: SCOPE, markerId: 'mA'
  });

  // This save: mA's row RENAMED (token must still win — tier 0 beats all content);
  // mC's row MOVED verbatim into mB's old slot 5 (exact content must beat the slot);
  // mB's row EDITED (notes) and moved to slot 7 (one-field overlap now reviews).
  const plan = await runPlan({
    dataRows: [
      excelRow(token, vals('Alpha RENAMED', 'a'), 2),
      excelRow('', cVals, 5),
      excelRow('', vals('Beta', 'b-edited'), 7)
    ],
    surveyMarkers
  });

  const dTok = plan.byRowIndex.get(1);
  assert.equal(dTok.decision, 'match', 'Row-ID token binds first, surviving a full rename');
  assert.equal(dTok.action, 'apply');
  assert.equal(dTok.markerId, 'mA');

  const dExact = plan.byRowIndex.get(2);
  assert.equal(dExact.decision, 'missing-rowid');
  assert.equal(dExact.markerId, 'mC', 'exact content beats the slot it landed in (mB\'s old slot)');
  assert.equal(dExact.recoveredBy, undefined, 'exact tier — position never outranks an exact match');

  const dEdited = plan.byRowIndex.get(3);
  assert.equal(dEdited.decision, 'ambiguous-identity');
  assert.deepEqual(dEdited.candidateMarkerIds, ['mB']);

  assert.ok(decisionsOf(plan).every((d) => d.action !== 'create'), 'zero creates');
  assert.deepEqual(plan.candidateDeletes, []);
});
