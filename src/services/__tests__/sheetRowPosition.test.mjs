// Slice 2 of the blank-Row-ID matching plan (.planning/blank-rowid-matching-verdict.md):
// capture + persist TRUE sheet row positions, with NO matching-behavior change.
//
//   1. Parse-loop capture contract: the inline exceljs loops in PDFViewer.jsx are not
//      importable, so the eachRow → sheetRowNumber-expando pattern they use is pinned
//      here against a real ExcelJS write→read round-trip with a gap row (the exact
//      contract the inline code relies on: eachRow skips empty rows but reports the
//      TRUE 1-based rowNumber, and a non-index expando survives on the row array).
//   2. buildScopeImportPlans threads sheetRowNumber → identityRecord.lastSeenRowNumber
//      (+ ingestSeq → lastIngestSeq) on every apply/create decision.
//   3. Absence of the stamps is harmless: same decisions, null fields, no throw —
//      records without the new fields stay valid (older data, other devices).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { buildScopeImportPlans, scopeKeyFor } from '../buildScopeImportPlans.js';
import { buildImportPlan } from '../rowImportMatcher.js';
import { buildMarkerIdentityRecord } from '../excelIdentityRecord.js';
import { generateRowIdToken } from '../rowIdToken.js';

const KEY_ID = 'k1';
const SECRET = 'dGVzdC1zZWNyZXQtZm9yLXNoZWV0LXJvdy1wb3M=';
const DOC = 'doc-1:pdf-1';
const MODULE = 'mod-1';
const CATEGORY = 'cat-1';
const SCOPE = `${MODULE}:${CATEGORY}`;
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

async function markerWithRecord(markerId, vals) {
  const record = await buildMarkerIdentityRecord({ values: rowValuesFor(vals), exportId: 'exp-1' });
  return { moduleId: MODULE, categoryId: CATEGORY, name: vals.item, excelSync: record };
}

// Attach the parse-loop expando (what PDFViewer's eachRow loops now stamp).
const withSheetRow = (rowArray, sheetRowNumber) => {
  rowArray.sheetRowNumber = sheetRowNumber;
  return rowArray;
};

const plansFor = (jsonData, surveyMarkers, extra = {}) => buildScopeImportPlans({
  worksheetDataList: [{ jsonData, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
  surveyMarkers, templateToUse, documentId: DOC, resolveSecret,
  logger: () => {},
  ...extra
});

// --- 1. parse-loop capture contract (mirrors the inline PDFViewer loops) ---------------

test('eachRow capture: gap row is skipped but each row keeps its TRUE 1-based sheet row', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(headerRow); // sheet row 1
  ws.addRow(excelRowFor('', { item: 'Door 12' })); // sheet row 2
  // sheet row 3 left genuinely empty (no cells); data continues at sheet row 4
  excelRowFor('', { item: 'Window 3' }).forEach((v, idx) => {
    ws.getRow(4).getCell(idx + 1).value = v;
  });
  const buffer = await wb.xlsx.writeBuffer();

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buffer);
  const ws2 = wb2.getWorksheet('Sheet1');

  // EXACT pattern of the two inline parse loops in PDFViewer.jsx (manual + auto/Graph).
  const jsonData = [];
  ws2.eachRow((row, rowNumber) => {
    const rowData = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      rowData[colNumber - 1] = cell.value;
    });
    rowData.sheetRowNumber = rowNumber;
    jsonData.push(rowData);
  });

  assert.equal(jsonData.length, 3, 'empty sheet row 3 is compacted away');
  assert.equal(jsonData[0].sheetRowNumber, 1, 'header row is sheet row 1');
  assert.equal(jsonData[1].sheetRowNumber, 2);
  assert.equal(jsonData[2].sheetRowNumber, 4, 'row after the gap keeps its TRUE sheet row');
  // The expando must not disturb index-based consumption of the row array.
  assert.equal(jsonData[1][3], 'Door 12');
  assert.equal(jsonData[2][3], 'Window 3');
  assert.equal(jsonData[1].length, headerRow.length, 'array length unchanged by the expando');
});

// --- 2. stamping at the attachment point ------------------------------------------------

test('apply/create identity records carry lastSeenRowNumber + lastIngestSeq (match, recovery, create)', async () => {
  const token = await generateRowIdToken({ keyId: KEY_ID, secret: SECRET, documentId: DOC, scopeId: SCOPE, markerId: 'm1' });
  const surveyMarkers = {
    m1: await markerWithRecord('m1', { item: 'Door 12' }), // token match (apply)
    m2: await markerWithRecord('m2', { item: 'Window 3' }) // blank recovery (apply)
  };
  const jsonData = [
    withSheetRow([...headerRow], 1),
    withSheetRow(excelRowFor(token, { item: 'Door 12' }), 2),
    withSheetRow(excelRowFor('', { item: 'Window 3' }), 4), // gap: sheet row ≠ array index
    withSheetRow(excelRowFor('', { item: 'Brand New' }), 5) // genuinely new (create)
  ];

  const SEQ = 1765432100000;
  const plans = await plansFor(jsonData, surveyMarkers, { ingestSeq: SEQ });
  const plan = plans.get(scopeKeyFor(MODULE, CATEGORY));

  const matched = plan.byRowIndex.get(1);
  assert.equal(matched.action, 'apply');
  assert.equal(matched.identityRecord.lastSeenRowNumber, 2);
  assert.equal(matched.identityRecord.lastIngestSeq, SEQ);

  const recovered = plan.byRowIndex.get(2);
  assert.equal(recovered.decision, 'missing-rowid');
  assert.equal(recovered.action, 'apply');
  assert.equal(recovered.identityRecord.lastSeenRowNumber, 4, 'TRUE sheet row, not the compacted index');
  assert.equal(recovered.identityRecord.lastIngestSeq, SEQ);

  const created = plan.byRowIndex.get(3);
  assert.equal(created.action, 'create');
  assert.equal(created.identityRecord.lastSeenRowNumber, 5);
  assert.equal(created.identityRecord.lastIngestSeq, SEQ);
});

// --- 3. absence degrades safely (no behavior change) ------------------------------------

test('rows without sheetRowNumber and no ingestSeq: same decisions, null stamps, no throw', async () => {
  const surveyMarkers = { m1: await markerWithRecord('m1', { item: 'Door 12' }) };
  const bare = [
    [...headerRow],
    excelRowFor('', { item: 'Door 12' }), // exact-fingerprint recovery
    excelRowFor('', { item: 'Brand New' }) // create
  ];
  const stamped = [
    withSheetRow([...headerRow], 1),
    withSheetRow(excelRowFor('', { item: 'Door 12' }), 2),
    withSheetRow(excelRowFor('', { item: 'Brand New' }), 3)
  ];

  const planBare = (await plansFor(bare, surveyMarkers)).get(scopeKeyFor(MODULE, CATEGORY));
  const planStamped = (await plansFor(stamped, { m1: await markerWithRecord('m1', { item: 'Door 12' }) }, { ingestSeq: 7 }))
    .get(scopeKeyFor(MODULE, CATEGORY));

  // Identical decision/action/markerId with and without positional data (slice-2 invariant).
  for (const idx of [1, 2]) {
    const a = planBare.byRowIndex.get(idx);
    const b = planStamped.byRowIndex.get(idx);
    assert.equal(a.decision, b.decision);
    assert.equal(a.action, b.action);
    assert.equal(a.markerId, b.markerId);
  }
  assert.deepEqual(planBare.candidateDeletes, planStamped.candidateDeletes);

  // Unstamped records stay valid: fields present but null (absence semantics).
  assert.equal(planBare.byRowIndex.get(1).identityRecord.lastSeenRowNumber, null);
  assert.equal(planBare.byRowIndex.get(1).identityRecord.lastIngestSeq, null);
});

test('matcher ignores sheetRowNumber on its input rows (no behavior change in this slice)', async () => {
  const stored = [{
    markerId: 'm1',
    ...(await buildMarkerIdentityRecord({ values: rowValuesFor({ item: 'Door 12' }) }))
  }];
  const rows = [{ rowIdCell: '', values: rowValuesFor({ item: 'Door 12' }) }];
  const rowsPos = [{ ...rows[0], sheetRowNumber: 2 }];

  const a = await buildImportPlan({ rows, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  const b = await buildImportPlan({ rows: rowsPos, stored, documentId: DOC, scopeId: SCOPE, resolveSecret });
  assert.deepEqual(
    a.decisions.map(({ rowIndex, decision, action, markerId }) => ({ rowIndex, decision, action, markerId })),
    b.decisions.map(({ rowIndex, decision, action, markerId }) => ({ rowIndex, decision, action, markerId }))
  );
});

// --- 4. record-builder contract ----------------------------------------------------------

test('buildMarkerIdentityRecord: positional fields default to null and reject invalid input', async () => {
  const values = rowValuesFor({ item: 'Door 12' });

  const omitted = await buildMarkerIdentityRecord({ values });
  assert.equal(omitted.lastSeenRowNumber, null);
  assert.equal(omitted.lastIngestSeq, null);

  const stamped = await buildMarkerIdentityRecord({ values, lastSeenRowNumber: 9, lastIngestSeq: 123 });
  assert.equal(stamped.lastSeenRowNumber, 9);
  assert.equal(stamped.lastIngestSeq, 123);

  // Non-positive / non-integer positions are "unknown", never garbage.
  // Same contract for the ingest sequence — future tiers may SORT on it.
  for (const bad of [0, -3, 1.5, '4', NaN, Infinity]) {
    const rec = await buildMarkerIdentityRecord({ values, lastSeenRowNumber: bad, lastIngestSeq: bad });
    assert.equal(rec.lastSeenRowNumber, null, `lastSeenRowNumber=${String(bad)} → null`);
    assert.equal(rec.lastIngestSeq, null, `lastIngestSeq=${String(bad)} → null`);
  }
});

// --- 5. slice 3: positional stamps + cross-scope fingerprints THREAD THROUGH the plans
//        bridge into the matcher (end-to-end through buildScopeImportPlans) -------------

test('slice 3 threading: a TOTAL REWRITE at the remembered slot pairs through buildScopeImportPlans (no duplicate)', async () => {
  // The marker remembers sheet row 2 from the last ingest; the row at sheet 2 now has
  // EVERY identity field changed. Only the positional tier (fed by stored[] threading)
  // can pair this — content-only matching would emit new-row + a delete candidate.
  const record = await buildMarkerIdentityRecord({
    values: rowValuesFor({ item: 'test', answer: 'Y', entity: 'North', notes: 'ok' }),
    origin: 'import', lastSeenRowNumber: 2, lastIngestSeq: 9
  });
  const surveyMarkers = { m1: { moduleId: MODULE, categoryId: CATEGORY, name: 'test', excelSync: record } };
  const jsonData = [
    withSheetRow([...headerRow], 1),
    withSheetRow(excelRowFor('', { item: 'car', answer: 'N', entity: 'South', notes: 'changed' }), 2)
  ];
  const plan = (await plansFor(jsonData, surveyMarkers)).get(scopeKeyFor(MODULE, CATEGORY));
  const d = plan.byRowIndex.get(1);
  assert.equal(d.decision, 'missing-rowid', 'Amendment #2: silent same-row match through the full bridge');
  assert.equal(d.action, 'apply');
  assert.equal(d.markerId, 'm1');
  assert.deepEqual(plan.candidateDeletes, []);
});

test('slice 3 threading: blank rows in one worksheet SHIELD another scope\'s marker (cross-scope reconciliation)', async () => {
  const MODULE2 = 'mod-2';
  const CATEGORY2 = 'cat-2';
  // Both categories share the checklist item id, so the cut row's identity fingerprint
  // is the same in both scopes (the shield is exact-fingerprint based).
  const template2 = {
    modules: [
      { id: MODULE, categories: [{ id: CATEGORY, checklist: [{ id: 'chk-1', text: 'Locked?' }] }] },
      { id: MODULE2, categories: [{ id: CATEGORY2, checklist: [{ id: 'chk-1', text: 'Locked?' }] }] }
    ]
  };
  const cutVals = { item: 'Cut Row', answer: 'Y', entity: 'North', notes: 'payload' };
  const surveyMarkers = {
    mCut: {
      moduleId: MODULE, categoryId: CATEGORY, name: 'Cut Row',
      excelSync: await buildMarkerIdentityRecord({ values: rowValuesFor(cutVals), origin: 'import' })
    }
  };
  // Scope A keeps a DIFFERENT blank row sharing mCut's Item (would pair without the
  // shield); the cut row itself was pasted VERBATIM into scope B's sheet.
  const sheetA = [
    withSheetRow([...headerRow], 1),
    withSheetRow(excelRowFor('', { item: 'Cut Row', answer: 'N', entity: 'South', notes: 'other' }), 2)
  ];
  const sheetB = [
    withSheetRow([...headerRow], 1),
    withSheetRow(excelRowFor('', cutVals), 2)
  ];
  const plans = await buildScopeImportPlans({
    worksheetDataList: [
      { jsonData: sheetA, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE },
      { jsonData: sheetB, headerRow, matchedCategory: { id: CATEGORY2 }, matchedModuleId: MODULE2 }
    ],
    surveyMarkers, templateToUse: template2, documentId: DOC, resolveSecret, logger: () => {}
  });
  const planA = plans.get(scopeKeyFor(MODULE, CATEGORY));
  const planB = plans.get(scopeKeyFor(MODULE2, CATEGORY2));
  assert.equal(planA.byRowIndex.get(1).decision, 'new-row',
    'the overlapping local row must NOT steal the moved marker');
  assert.deepEqual(planA.candidateDeletes, ['mCut'],
    'the move degrades to a silent, restorable delete in the old scope');
  assert.equal(planB.byRowIndex.get(1).decision, 'new-row', 'the pasted row creates in its new scope');
});

test('conflict-resolve re-stamp preserves positional memory (the PDFViewer merge pattern)', async () => {
  // A marker that was stamped with a position by a prior import…
  const prior = await buildMarkerIdentityRecord({
    values: rowValuesFor({ item: 'Door 12' }), origin: 'import',
    lastSeenRowNumber: 7, lastIngestSeq: 555
  });
  // …then goes through handleResolveExcelConflict's EXACT re-stamp pattern: rebuild
  // the record from Excel's values, passing the prior positional stamps through,
  // then spread over the old excelSync. Position must survive the content re-baseline.
  const record = await buildMarkerIdentityRecord({
    values: rowValuesFor({ item: 'Door 12', notes: 'edited in Excel' }),
    origin: 'conflict-resolve',
    lastSeenRowNumber: prior.lastSeenRowNumber ?? null,
    lastIngestSeq: prior.lastIngestSeq ?? null
  });
  const merged = { ...prior, ...record };
  assert.equal(merged.origin, 'conflict-resolve');
  assert.equal(merged.lastSeenRowNumber, 7, 'position survives conflict resolution');
  assert.equal(merged.lastIngestSeq, 555, 'ingest seq survives conflict resolution');
  // And a marker with NO positional memory stays cleanly null (no throw, no garbage).
  const bare = await buildMarkerIdentityRecord({ values: rowValuesFor({ item: 'Door 12' }) });
  const rebare = await buildMarkerIdentityRecord({
    values: rowValuesFor({ item: 'Door 12' }), origin: 'conflict-resolve',
    lastSeenRowNumber: bare.lastSeenRowNumber ?? null,
    lastIngestSeq: bare.lastIngestSeq ?? null
  });
  assert.equal(rebare.lastSeenRowNumber, null);
  assert.equal(rebare.lastIngestSeq, null);
});
