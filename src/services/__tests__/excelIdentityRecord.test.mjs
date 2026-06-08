import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTITY_RECORD_VERSION,
  buildMarkerIdentityRecord,
  buildMarkerIdentityRecords,
  applyMarkerIdentityRecords
} from '../excelIdentityRecord.js';
import { computeRowFingerprints } from '../rowFingerprint.js';

const values = {
  changedBy: 'IC',
  changedDate: '6/8/2026',
  item: 'Door 12',
  entity: 'North Wing',
  notes: 'Needs paint.',
  answers: { 'chk-1': 'Y', 'chk-2': 'N', 'chk-3': 'N/A' }
};

test('buildMarkerIdentityRecord matches computeRowFingerprints on the same values', async () => {
  const rec = await buildMarkerIdentityRecord({ values, exportId: 'exp-1' });
  const fp = await computeRowFingerprints(values);

  assert.equal(rec.version, IDENTITY_RECORD_VERSION);
  assert.equal(rec.lastExportId, 'exp-1');
  assert.equal(rec.wasWrittenAsRow, true);
  assert.equal(rec.identityVectorFingerprint, fp.identityVectorFingerprint);
  assert.equal(rec.fullRowFingerprint, fp.fullRowFingerprint);
  assert.deepEqual(rec.fieldFingerprints, fp.fieldFingerprints);
});

test('exportId defaults to null when omitted', async () => {
  const rec = await buildMarkerIdentityRecord({ values });
  assert.equal(rec.lastExportId, null);
});

test('buildMarkerIdentityRecords keys by markerId and skips entries without one', async () => {
  const records = await buildMarkerIdentityRecords({
    exportId: 'exp-2',
    rows: [
      { markerId: 'm1', values },
      { markerId: 'm2', values: { ...values, item: 'Window 3' } },
      { values }, // no markerId → skipped
      null // ignored
    ]
  });
  assert.deepEqual(Object.keys(records).sort(), ['m1', 'm2']);
  assert.equal(records.m1.lastExportId, 'exp-2');
  // Different item → different identity-vector fingerprint.
  assert.notEqual(records.m1.identityVectorFingerprint, records.m2.identityVectorFingerprint);
});

test('applyMarkerIdentityRecords sets excelSync without mutating the input', async () => {
  const records = await buildMarkerIdentityRecords({ rows: [{ markerId: 'm1', values }], exportId: 'e' });
  const markers = { m1: { name: 'Door 12', moduleId: 'mod' }, m2: { name: 'Other' } };
  const out = applyMarkerIdentityRecords(markers, records);

  assert.ok(out.m1.excelSync, 'm1 gets a record');
  assert.equal(out.m1.excelSync.identityVectorFingerprint, records.m1.identityVectorFingerprint);
  assert.equal(out.m1.name, 'Door 12', 'other marker fields preserved');
  assert.equal(out.m2.excelSync, undefined, 'unwritten marker left unchanged');
  assert.equal(markers.m1.excelSync, undefined, 'original input not mutated');
});

test('applyMarkerIdentityRecords tolerates empty inputs', () => {
  assert.deepEqual(applyMarkerIdentityRecords(), {});
  assert.deepEqual(applyMarkerIdentityRecords({ a: { x: 1 } }, {}), { a: { x: 1 } });
});
