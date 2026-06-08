import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROW_FINGERPRINT_VERSION,
  canonicalizeCellValue,
  buildRowRecord,
  computeRowFingerprints,
  diffRowFields,
  __testing
} from '../rowFingerprint.js';

const baseRow = {
  changedBy: 'IC',
  changedDate: '6/8/2026',
  item: 'Door 12',
  entity: 'North Wing',
  notes: 'Needs paint.',
  answers: { 'chk-1': 'Y', 'chk-2': 'N', 'chk-3': 'N/A' }
};

test('canonicalize handles plain values', () => {
  assert.equal(canonicalizeCellValue('  hi  '), '  hi'); // trailing trimmed, leading preserved (per spec)
  assert.equal(canonicalizeCellValue(''), __testing.SENTINEL_EMPTY);
  assert.equal(canonicalizeCellValue(null), __testing.SENTINEL_EMPTY);
  assert.equal(canonicalizeCellValue(undefined), __testing.SENTINEL_EMPTY);
  assert.equal(canonicalizeCellValue(true), 'true');
  assert.equal(canonicalizeCellValue(0), '0');
  assert.equal(canonicalizeCellValue(-0), '0');
  assert.equal(canonicalizeCellValue(1.5), '1.5');
  assert.equal(canonicalizeCellValue('a\r\nb'), 'a\nb'); // line endings normalized
});

test('canonicalize handles ExcelJS cell shapes (rich text, formula, hyperlink, date)', () => {
  assert.equal(canonicalizeCellValue({ richText: [{ text: 'Hello ' }, { text: 'world' }] }), 'Hello world');
  assert.equal(canonicalizeCellValue({ formula: 'A1&B1', result: 'YN' }), 'YN');
  assert.equal(canonicalizeCellValue({ formula: 'A1', result: null }), __testing.SENTINEL_EMPTY);
  assert.equal(canonicalizeCellValue({ text: 'click', hyperlink: 'http://x' }), 'click');
  assert.equal(canonicalizeCellValue({ error: '#REF!' }), __testing.SENTINEL_EMPTY);
  const d = new Date('2026-06-08T00:00:00.000Z');
  assert.equal(canonicalizeCellValue(d), '2026-06-08T00:00:00.000Z');
});

test('a plain string and the equivalent rich-text cell fingerprint identically', async () => {
  const plain = await computeRowFingerprints({ ...baseRow, notes: 'Hello world' });
  const rich = await computeRowFingerprints({ ...baseRow, notes: { richText: [{ text: 'Hello ' }, { text: 'world' }] } });
  assert.equal(plain.fullRowFingerprint, rich.fullRowFingerprint);
});

test('fingerprints are versioned and deterministic', async () => {
  const a = await computeRowFingerprints(baseRow);
  const b = await computeRowFingerprints(baseRow);
  assert.ok(a.fullRowFingerprint.startsWith(`${ROW_FINGERPRINT_VERSION}:`));
  assert.equal(a.fullRowFingerprint, b.fullRowFingerprint);
  assert.equal(a.identityVectorFingerprint, b.identityVectorFingerprint);
});

test('answer column order does not change any fingerprint', async () => {
  const reordered = { ...baseRow, answers: { 'chk-3': 'N/A', 'chk-1': 'Y', 'chk-2': 'N' } };
  const a = await computeRowFingerprints(baseRow);
  const b = await computeRowFingerprints(reordered);
  assert.equal(a.fullRowFingerprint, b.fullRowFingerprint);
  assert.equal(a.identityVectorFingerprint, b.identityVectorFingerprint);
});

test('field boundaries are unambiguous (no field can bleed into the next)', async () => {
  const a = await computeRowFingerprints({ ...baseRow, item: 'AB', entity: 'C' });
  const b = await computeRowFingerprints({ ...baseRow, item: 'A', entity: 'BC' });
  assert.notEqual(a.identityVectorFingerprint, b.identityVectorFingerprint);
});

test('editing an audit column changes the full fingerprint but NOT the identity vector', async () => {
  const edited = { ...baseRow, changedBy: 'XY', changedDate: '6/9/2026' };
  const a = await computeRowFingerprints(baseRow);
  const b = await computeRowFingerprints(edited);
  assert.notEqual(a.fullRowFingerprint, b.fullRowFingerprint);
  assert.equal(a.identityVectorFingerprint, b.identityVectorFingerprint);
});

test('editing an answer changes both the full fingerprint and the identity vector', async () => {
  const edited = { ...baseRow, answers: { ...baseRow.answers, 'chk-2': 'Y' } };
  const a = await computeRowFingerprints(baseRow);
  const b = await computeRowFingerprints(edited);
  assert.notEqual(a.fullRowFingerprint, b.fullRowFingerprint);
  assert.notEqual(a.identityVectorFingerprint, b.identityVectorFingerprint);
});

test('renaming the item changes the identity vector', async () => {
  const a = await computeRowFingerprints(baseRow);
  const b = await computeRowFingerprints({ ...baseRow, item: 'Door 13' });
  assert.notEqual(a.identityVectorFingerprint, b.identityVectorFingerprint);
});

test('diffRowFields reports exactly which fields changed', async () => {
  const a = await computeRowFingerprints(baseRow);
  const b = await computeRowFingerprints({
    ...baseRow,
    notes: 'Painted.',
    answers: { ...baseRow.answers, 'chk-2': 'Y' }
  });
  const changed = diffRowFields(a.fieldFingerprints, b.fieldFingerprints);
  assert.deepEqual(changed, ['answer:chk-2', 'notes']);
});

test('diffRowFields on identical rows reports nothing changed', async () => {
  const a = await computeRowFingerprints(baseRow);
  const b = await computeRowFingerprints(baseRow);
  assert.deepEqual(diffRowFields(a.fieldFingerprints, b.fieldFingerprints), []);
});

test('diffRowFields treats an added/removed answer as changed', async () => {
  const a = await computeRowFingerprints(baseRow);
  const b = await computeRowFingerprints({ ...baseRow, answers: { 'chk-1': 'Y', 'chk-2': 'N' } }); // chk-3 removed
  assert.deepEqual(diffRowFields(a.fieldFingerprints, b.fieldFingerprints), ['answer:chk-3']);
});

test('blank vs empty-string vs whitespace all canonicalize to the same fingerprint', async () => {
  const r1 = await computeRowFingerprints({ ...baseRow, notes: '' });
  const r2 = await computeRowFingerprints({ ...baseRow, notes: '   ' });
  const r3 = await computeRowFingerprints({ ...baseRow, notes: null });
  assert.equal(r1.fullRowFingerprint, r2.fullRowFingerprint);
  assert.equal(r1.fullRowFingerprint, r3.fullRowFingerprint);
});

test('buildRowRecord serialization is stable across calls', () => {
  const a = buildRowRecord(baseRow);
  const b = buildRowRecord(baseRow);
  assert.equal(a.fullSerialized, b.fullSerialized);
  assert.equal(a.identitySerialized, b.identitySerialized);
});
