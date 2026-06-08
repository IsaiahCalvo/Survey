// Stage 0 — export-acknowledgment metadata + dirty-state interaction.
//
// On a successful export, every marker is stamped "received by Excel"
// (exportedAt). That stamp is the prerequisite for the received-only delete
// rule. Critically, stamping must NOT make a freshly-synced survey look unsynced
// again — the ack fields are excluded from the dirty fingerprint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_ACK_FIELDS,
  stampExportAck,
  wasReceivedByExcel,
} from '../src/services/excelExportAck.js';
import {
  computeExcelSyncFingerprint,
  computeHasPendingExcelSyncChanges,
} from '../src/utils/excelSyncDirtyState.js';

const template = { id: 't1', supabaseId: 'sb1', linkedExcelPath: '/book.xlsx' };
const markers = {
  m1: { name: 'A', checklistResponses: { c1: { selection: 'Y' } }, pageNumber: 1, bounds: { x: 0, y: 0, width: 5, height: 5 } },
  m2: { name: 'B', pageNumber: null, bounds: null },
};

test('stampExportAck marks every marker as received, without mutating the input', () => {
  const exportedAt = '2026-06-08T00:00:00.000Z';
  const stamped = stampExportAck(markers, { exportedAt, eTag: 'etag-123' });
  for (const key of Object.keys(markers)) {
    assert.equal(stamped[key].exportedAt, exportedAt);
    assert.equal(stamped[key].exportAckEtag, 'etag-123');
    assert.equal(wasReceivedByExcel(stamped[key]), true);
  }
  // original untouched
  assert.equal('exportedAt' in markers.m1, false);
});

test('wasReceivedByExcel is false until a marker has been exported', () => {
  assert.equal(wasReceivedByExcel(markers.m1), false);
  assert.equal(wasReceivedByExcel({ exportedAt: '2026-06-08T00:00:00.000Z' }), true);
  assert.equal(wasReceivedByExcel(null), false);
});

test('stamping export-ack does NOT change the dirty fingerprint', () => {
  const before = computeExcelSyncFingerprint(template, markers).hash;
  const stamped = stampExportAck(markers, { exportedAt: '2026-06-08T00:00:00.000Z', eTag: 'e1' });
  const after = computeExcelSyncFingerprint(template, stamped).hash;
  assert.equal(after, before, 'ack fields must be excluded from the hash');
});

test('a freshly-exported survey reads as synced (not pending) against its own baseline', () => {
  // Baseline captured at export time from the stamped markers.
  const stamped = stampExportAck(markers, { exportedAt: '2026-06-08T00:00:00.000Z' });
  const baselineHash = computeExcelSyncFingerprint(template, stamped).hash;
  // Same stamped markers later → still not pending.
  assert.equal(
    computeHasPendingExcelSyncChanges({ template, surveyMarkers: stamped, baselineHash }),
    false,
  );
});

test('a real user edit after export still flags pending', () => {
  const stamped = stampExportAck(markers, { exportedAt: '2026-06-08T00:00:00.000Z' });
  const baselineHash = computeExcelSyncFingerprint(template, stamped).hash;
  const edited = { ...stamped, m1: { ...stamped.m1, name: 'A-renamed' } };
  assert.equal(
    computeHasPendingExcelSyncChanges({ template, surveyMarkers: edited, baselineHash }),
    true,
  );
});

test('EXPORT_ACK_FIELDS is the documented bookkeeping set', () => {
  // `excelSync` is the durable per-marker identity record (excelIdentityRecord.js),
  // sync bookkeeping like the ack timestamp — stripped from the dirty fingerprint.
  assert.deepEqual([...EXPORT_ACK_FIELDS], ['exportedAt', 'exportAckEtag', 'excelSync']);
});
