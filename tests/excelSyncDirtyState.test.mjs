import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeExcelSyncFingerprint,
  computeHasPendingExcelSyncChanges
} from '../src/utils/excelSyncDirtyState.js';

const linkedTemplate = {
  id: 'template-1',
  supabaseId: 'supabase-template-1',
  linkedExcelPath: '/tmp/survey.xlsx',
  oneDriveApiPath: '/Documents/survey.xlsx',
  oneDriveFileId: 'onedrive-file-1'
};

test('computeHasPendingExcelSyncChanges returns false when no linked Excel path exists', () => {
  const pending = computeHasPendingExcelSyncChanges({
    template: { id: 'template-1', linkedExcelPath: null },
    surveyMarkers: { a: { name: 'Item A' } },
    baselineHash: null
  });

  assert.equal(pending, false);
});

test('computeHasPendingExcelSyncChanges returns true when baseline is missing', () => {
  const pending = computeHasPendingExcelSyncChanges({
    template: linkedTemplate,
    surveyMarkers: {},
    baselineHash: null
  });

  assert.equal(pending, true);
});

test('computeHasPendingExcelSyncChanges returns false when baseline matches', () => {
  const surveyMarkers = {
    a: { name: 'Item A', checklistResponses: { checklistA: { selection: 'Y' } } }
  };
  const baseline = computeExcelSyncFingerprint(linkedTemplate, surveyMarkers);

  const pending = computeHasPendingExcelSyncChanges({
    template: linkedTemplate,
    surveyMarkers,
    baselineHash: baseline.hash
  });

  assert.equal(pending, false);
});

test('computeHasPendingExcelSyncChanges returns true when highlight annotations change', () => {
  const baseHighlights = { a: { name: 'Item A' } };
  const changedHighlights = { a: { name: 'Item A Updated' } };
  const baseline = computeExcelSyncFingerprint(linkedTemplate, baseHighlights);

  const pending = computeHasPendingExcelSyncChanges({
    template: linkedTemplate,
    surveyMarkers: changedHighlights,
    baselineHash: baseline.hash
  });

  assert.equal(pending, true);
});

test('computeHasPendingExcelSyncChanges returns true when template identity changes', () => {
  const highlights = { a: { name: 'Item A' } };
  const baseline = computeExcelSyncFingerprint(linkedTemplate, highlights);
  const movedTemplate = {
    ...linkedTemplate,
    oneDriveApiPath: '/Renamed/survey.xlsx'
  };

  const pending = computeHasPendingExcelSyncChanges({
    template: movedTemplate,
    surveyMarkers: highlights,
    baselineHash: baseline.hash
  });

  assert.equal(pending, true);
});

