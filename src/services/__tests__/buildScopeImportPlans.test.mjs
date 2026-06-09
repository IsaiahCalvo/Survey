import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildScopeImportPlans, scopeKeyFor } from '../buildScopeImportPlans.js';
import { generateRowIdToken } from '../rowIdToken.js';
import { computeRowFingerprints } from '../rowFingerprint.js';
import { buildMarkerIdentityRecord } from '../excelIdentityRecord.js';

const KEY_ID = 'k1';
const SECRET = 'dGVzdC1zZWNyZXQtZm9yLWltcG9ydC1wbGFucw==';
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

// header + the values a row carries (must fingerprint identically to export)
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

test('valid in-scope token on its exported marker → match (apply) at the right row index', async () => {
  const token = await generateRowIdToken({ keyId: KEY_ID, secret: SECRET, documentId: DOC, scopeId: SCOPE, markerId: 'm1' });
  const surveyMarkers = { m1: await markerWithRecord('m1', { item: 'Door 12' }) };
  const jsonData = [headerRow, excelRowFor(token, { item: 'Door 12 RENAMED' })]; // rename → still same marker

  const plans = await buildScopeImportPlans({
    worksheetDataList: [{ jsonData, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret
  });

  const plan = plans.get(scopeKeyFor(MODULE, CATEGORY));
  assert.ok(plan, 'scope has a plan');
  const decision = plan.byRowIndex.get(1); // Excel data row 1 (jsonData[1])
  assert.equal(decision.decision, 'match');
  assert.equal(decision.action, 'apply');
  assert.equal(decision.markerId, 'm1');
  assert.deepEqual(plan.candidateDeletes, []);
});

test('blank Row ID with no leftover content match → new-row (create)', async () => {
  const surveyMarkers = {}; // nothing stored
  const jsonData = [headerRow, excelRowFor('', { item: 'Brand New' })];

  const plans = await buildScopeImportPlans({
    worksheetDataList: [{ jsonData, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret
  });
  const decision = plans.get(scopeKeyFor(MODULE, CATEGORY)).byRowIndex.get(1);
  assert.equal(decision.decision, 'new-row');
  assert.equal(decision.action, 'create');
});

test('blank Row ID matching a stored fingerprint → missing-rowid (apply, recovered)', async () => {
  const surveyMarkers = { m1: await markerWithRecord('m1', { item: 'Door 12' }) };
  // same visible values, but the Row ID cell was cleared by the user
  const jsonData = [headerRow, excelRowFor('', { item: 'Door 12' })];

  const plans = await buildScopeImportPlans({
    worksheetDataList: [{ jsonData, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret
  });
  const decision = plans.get(scopeKeyFor(MODULE, CATEGORY)).byRowIndex.get(1);
  assert.equal(decision.decision, 'missing-rowid');
  assert.equal(decision.action, 'apply');
  assert.equal(decision.markerId, 'm1');
});

test('garbage Row ID → malformed-rowid (review, never written)', async () => {
  const surveyMarkers = {};
  const jsonData = [headerRow, excelRowFor('not-a-real-token', { item: 'Weird' })];

  const plans = await buildScopeImportPlans({
    worksheetDataList: [{ jsonData, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret
  });
  const decision = plans.get(scopeKeyFor(MODULE, CATEGORY)).byRowIndex.get(1);
  assert.equal(decision.decision, 'malformed-rowid');
  assert.equal(decision.action, 'review');
});

test('stored marker with no row → candidate-delete (review-only, never deleted here)', async () => {
  const token = await generateRowIdToken({ keyId: KEY_ID, secret: SECRET, documentId: DOC, scopeId: SCOPE, markerId: 'm1' });
  const surveyMarkers = {
    m1: await markerWithRecord('m1', { item: 'Door 12' }),
    m2: await markerWithRecord('m2', { item: 'Window 3' }) // exported, but absent from the sheet
  };
  const jsonData = [headerRow, excelRowFor(token, { item: 'Door 12' })];

  const plans = await buildScopeImportPlans({
    worksheetDataList: [{ jsonData, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret
  });
  const plan = plans.get(scopeKeyFor(MODULE, CATEGORY));
  assert.deepEqual(plan.candidateDeletes, ['m2']);
});

test('repeated save of one new blank row dedupes: create then recover (no twin)', async () => {
  const ws = (markers) => buildScopeImportPlans({
    worksheetDataList: [{
      jsonData: [headerRow, excelRowFor('', { item: 'Brand New' })],
      headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE
    }],
    surveyMarkers: markers, templateToUse, documentId: DOC, resolveSecret
  });

  // Save 1: nothing stored → the blank row is genuinely new, and the decision carries
  // a ready-to-stamp import identity record.
  const plan1 = (await ws({})).get(scopeKeyFor(MODULE, CATEGORY)).byRowIndex.get(1);
  assert.equal(plan1.decision, 'new-row');
  assert.ok(plan1.identityRecord, 'create decision carries an identity record');
  assert.equal(plan1.identityRecord.origin, 'import');

  // The app would create a marker and stamp that record as its excelSync. Simulate it.
  const markers = { m1: { moduleId: MODULE, categoryId: CATEGORY, name: 'Brand New', excelSync: plan1.identityRecord } };

  // Save 2: the SAME blank row now recovers the remembered marker — missing-rowid,
  // apply to m1 — instead of creating a second item.
  const plan2 = (await ws(markers)).get(scopeKeyFor(MODULE, CATEGORY)).byRowIndex.get(1);
  assert.equal(plan2.decision, 'missing-rowid');
  assert.equal(plan2.action, 'apply');
  assert.equal(plan2.markerId, 'm1');
});

test('same field edited on both sides → apply downgraded to conflict review (Amendment #6)', async () => {
  const token = await generateRowIdToken({ keyId: KEY_ID, secret: SECRET, documentId: DOC, scopeId: SCOPE, markerId: 'm1' });
  // Last sync baseline: notes "ok".
  const surveyMarkers = { m1: await markerWithRecord('m1', { item: 'Door 12', notes: 'ok' }) };
  // Excel changed notes to "excel note".
  const jsonData = [headerRow, excelRowFor(token, { item: 'Door 12', notes: 'excel note' })];
  // The app changed the SAME notes field to something different.
  const appValuesByMarkerId = { m1: rowValuesFor({ item: 'Door 12', notes: 'app note' }) };

  const plans = await buildScopeImportPlans({
    worksheetDataList: [{ jsonData, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret, appValuesByMarkerId
  });

  const decision = plans.get(scopeKeyFor(MODULE, CATEGORY)).byRowIndex.get(1);
  assert.equal(decision.action, 'review');
  assert.equal(decision.decision, 'conflict');
  assert.deepEqual(decision.conflictFields, ['notes']);
  assert.ok(decision.excelValues, 'incoming Excel values are stashed for "use Excel’s version"');
  assert.equal(decision.excelValues.notes, 'excel note');
});

test('Excel-only change with app unchanged → stays apply (no false conflict)', async () => {
  const token = await generateRowIdToken({ keyId: KEY_ID, secret: SECRET, documentId: DOC, scopeId: SCOPE, markerId: 'm1' });
  const surveyMarkers = { m1: await markerWithRecord('m1', { item: 'Door 12', notes: 'ok' }) };
  const jsonData = [headerRow, excelRowFor(token, { item: 'Door 12', notes: 'excel note' })];
  // App side is identical to the baseline → only Excel moved → no conflict.
  const appValuesByMarkerId = { m1: rowValuesFor({ item: 'Door 12', notes: 'ok' }) };

  const plans = await buildScopeImportPlans({
    worksheetDataList: [{ jsonData, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret, appValuesByMarkerId
  });

  const decision = plans.get(scopeKeyFor(MODULE, CATEGORY)).byRowIndex.get(1);
  assert.equal(decision.action, 'apply');
  assert.equal(decision.decision, 'match');
});

test('without current app values, a match is never reclassified (back-compat)', async () => {
  const token = await generateRowIdToken({ keyId: KEY_ID, secret: SECRET, documentId: DOC, scopeId: SCOPE, markerId: 'm1' });
  const surveyMarkers = { m1: await markerWithRecord('m1', { item: 'Door 12', notes: 'ok' }) };
  const jsonData = [headerRow, excelRowFor(token, { item: 'Door 12', notes: 'excel note' })];

  const plans = await buildScopeImportPlans({
    worksheetDataList: [{ jsonData, headerRow, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
    surveyMarkers, templateToUse, documentId: DOC, resolveSecret // no appValuesByMarkerId
  });

  const decision = plans.get(scopeKeyFor(MODULE, CATEGORY)).byRowIndex.get(1);
  assert.equal(decision.action, 'apply');
});

test('worksheet with no Row ID column is omitted (caller keeps legacy match)', async () => {
  const legacyHeader = ['Changed By', 'Changed Date', 'Item', 'Locked?', 'Entity', 'Notes'];
  const jsonData = [legacyHeader, ['IC', '6/8/2026', 'Door 12', 'Y', 'North', 'ok']];

  const plans = await buildScopeImportPlans({
    worksheetDataList: [{ jsonData, headerRow: legacyHeader, matchedCategory: { id: CATEGORY }, matchedModuleId: MODULE }],
    surveyMarkers: {}, templateToUse, documentId: DOC, resolveSecret
  });
  assert.equal(plans.has(scopeKeyFor(MODULE, CATEGORY)), false);
});
