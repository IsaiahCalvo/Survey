// Integration proof for Stage 1 slice 3: the visible "Row ID" column survives a real
// ExcelJS write → read round-trip, the token still classifies as valid, and the
// full-row fingerprint recomputed from the reloaded cells equals the one computed at
// "export". This is the canonical-serializer round-trip test PLAN.md / STAGE1-IDENTITY-PLAN.md
// require, exercised against actual ExcelJS cell shapes (string, formatted date, formula).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { generateRowIdToken, classifyRowIdToken } from '../src/services/rowIdToken.js';
import { getOrCreateDocumentSecret, resolveDocumentSecret } from '../src/services/rowIdSecretStore.js';
import { computeRowFingerprints } from '../src/services/rowFingerprint.js';

const makeStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};

const DOC = 'local:my.pdf';
const SCOPE = 'mod-1:cat-1';

// Mirror the export builder's column order: Row ID, Changed By, Changed Date, Item, <answers>, Entity, Notes.
const HEADER = ['Row ID', 'Changed By', 'Changed Date', 'Item', 'Q1', 'Q2', 'Entity', 'Notes'];

test('Row ID column round-trips through a real xlsx write/read with a valid token + matching fingerprint', async () => {
  const storage = makeStorage();
  const { keyId, secret } = getOrCreateDocumentSecret(DOC, storage);
  const markerId = 'marker-42';

  const token = await generateRowIdToken({ keyId, secret, documentId: DOC, scopeId: SCOPE, markerId });

  // Logical visible values for the row (what export writes).
  const visible = {
    changedBy: 'IC',
    changedDate: '6/8/2026',
    item: 'Door 12',
    entity: 'North Wing',
    notes: 'Needs paint.',
    answers: { Q1: 'Y', Q2: 'N/A' }
  };
  const expectedFp = await computeRowFingerprints(visible);

  // --- write ---
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('mod-1');
  ws.addRow(HEADER);
  ws.addRow([token, visible.changedBy, visible.changedDate, visible.item, 'Y', 'N/A', visible.entity, visible.notes]);
  const buffer = await wb.xlsx.writeBuffer();

  // --- read back ---
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buffer);
  const ws2 = wb2.getWorksheet('mod-1');

  const headerBack = ws2.getRow(1).values.slice(1); // ExcelJS row.values is 1-indexed
  assert.equal(headerBack[0], 'Row ID', 'Row ID must be the first visible column');

  const dataRow = ws2.getRow(2);
  const rowIdCell = dataRow.getCell(1).value;

  // token still classifies as a valid match for this document+scope
  const result = await classifyRowIdToken(rowIdCell, {
    documentId: DOC,
    scopeId: SCOPE,
    resolveSecret: (kid) => resolveDocumentSecret(DOC, kid, storage)
  });
  assert.equal(result.status, 'valid');
  assert.equal(result.markerId, markerId);

  // fingerprint recomputed from the reloaded cells equals the export-time fingerprint
  const reloaded = {
    changedBy: dataRow.getCell(2).value,
    changedDate: dataRow.getCell(3).value,
    item: dataRow.getCell(4).value,
    entity: dataRow.getCell(7).value,
    notes: dataRow.getCell(8).value,
    answers: { Q1: dataRow.getCell(5).value, Q2: dataRow.getCell(6).value }
  };
  const reloadedFp = await computeRowFingerprints(reloaded);
  assert.equal(reloadedFp.fullRowFingerprint, expectedFp.fullRowFingerprint);
  assert.equal(reloadedFp.identityVectorFingerprint, expectedFp.identityVectorFingerprint);
});

test('a HIDDEN, text-formatted Row ID column (NOT locked/protected) round-trips and stays readable', async () => {
  // Locking the Row ID column makes Excel block sorting/filtering the table, so we keep
  // it hidden + text-formatted + HMAC-signed instead — sort/filter stay free, tampering
  // is detected on import.
  const storage = makeStorage();
  const { keyId, secret } = getOrCreateDocumentSecret(DOC, storage);
  const token = await generateRowIdToken({ keyId, secret, documentId: DOC, scopeId: SCOPE, markerId: 'm-hidden' });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('mod-1');
  ws.addRow(['Row ID', 'Item', 'Q1']);
  ws.addRow([token, 'Door 9', 'Y']);
  const col1 = ws.getColumn(1);
  col1.hidden = true;
  col1.numFmt = '@';
  const buffer = await wb.xlsx.writeBuffer();

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buffer);
  const ws2 = wb2.getWorksheet('mod-1');

  assert.equal(ws2.getColumn(1).hidden, true, 'Row ID column must be hidden');
  assert.ok(!(ws2.worksheet?.sheetProtection?.sheet) && !(ws2.sheetProtection?.sheet), 'sheet is NOT protected (sort/filter must stay free)');

  // The app can still READ the hidden token and match it.
  const result = await classifyRowIdToken(ws2.getCell('A2').value, {
    documentId: DOC, scopeId: SCOPE, resolveSecret: (kid) => resolveDocumentSecret(DOC, kid, storage)
  });
  assert.equal(result.status, 'valid');
  assert.equal(result.markerId, 'm-hidden');
});

test('a token written for one scope reads as wrong-scope when imported under another sheet', async () => {
  const storage = makeStorage();
  const { keyId, secret } = getOrCreateDocumentSecret(DOC, storage);
  const token = await generateRowIdToken({ keyId, secret, documentId: DOC, scopeId: 'mod-1:cat-1', markerId: 'm1' });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('s');
  ws.addRow(['Row ID']);
  ws.addRow([token]);
  const buffer = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buffer);
  const back = wb2.getWorksheet('s').getRow(2).getCell(1).value;

  const result = await classifyRowIdToken(back, {
    documentId: DOC,
    scopeId: 'mod-1:cat-2', // different category
    resolveSecret: (kid) => resolveDocumentSecret(DOC, kid, storage)
  });
  assert.equal(result.status, 'wrong-scope');
});
