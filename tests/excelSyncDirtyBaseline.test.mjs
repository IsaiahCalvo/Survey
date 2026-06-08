// Stage 0 pre-flight gate #3 (durable-baseline / fail-closed).
//
// The silent open-time Excel import is now gated on "no pending changes". That
// gate is only safe if the dirty-state check fails CLOSED: when there is no
// baseline to compare against (fresh open, in-memory ref lost on reload), it
// must report pending=true so no silent import can run. This test pins that
// contract so it can't regress out from under the gate in PDFViewer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeExcelSyncFingerprint,
  computeHasPendingExcelSyncChanges,
} from '../src/utils/excelSyncDirtyState.js';

const template = {
  id: 't1',
  supabaseId: 'sb1',
  linkedExcelPath: '/path/book.xlsx',
};
const markers = { m1: { name: 'A', pageNumber: 1, bounds: { x: 0, y: 0, width: 5, height: 5 } } };

test('fails closed: no baseline → pending=true (no silent import on fresh open)', () => {
  assert.equal(
    computeHasPendingExcelSyncChanges({ template, surveyMarkers: markers, baselineHash: null }),
    true,
  );
  assert.equal(
    computeHasPendingExcelSyncChanges({ template, surveyMarkers: markers, baselineHash: undefined }),
    true,
  );
});

test('matching baseline → pending=false (only then may a silent import run)', () => {
  const { hash } = computeExcelSyncFingerprint(template, markers);
  assert.equal(
    computeHasPendingExcelSyncChanges({ template, surveyMarkers: markers, baselineHash: hash }),
    false,
  );
});

test('drifted state → pending=true', () => {
  const { hash } = computeExcelSyncFingerprint(template, markers);
  const changed = { ...markers, m2: { name: 'B', pageNumber: 2, bounds: { x: 1, y: 1, width: 5, height: 5 } } };
  assert.equal(
    computeHasPendingExcelSyncChanges({ template, surveyMarkers: changed, baselineHash: hash }),
    true,
  );
});

test('no linked Excel → never pending (gate is a no-op without a link)', () => {
  assert.equal(
    computeHasPendingExcelSyncChanges({ template: { id: 't1' }, surveyMarkers: markers, baselineHash: null }),
    false,
  );
});
