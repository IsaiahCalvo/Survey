// Stage 0 pre-flight gate #2 (never-delete-a-placed-marker).
//
// Excel is attribute-only: an import may update answers/name/note/entity and
// may propose a new (unplaced) row, but it can NEVER destroy a placed Survey
// Marker or touch geometry. This test pins the pure deletion-candidate logic
// the live import path in PDFViewer.jsx now uses at both delete sites.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlacedSurveyMarker,
  computeImportDeletionCandidates,
} from '../src/services/surveyMarkerSyncDiff.js';

test('isPlacedSurveyMarker: placed requires a page number AND non-empty bounds', () => {
  assert.equal(isPlacedSurveyMarker({ pageNumber: 1, bounds: { x: 0, y: 0, width: 10, height: 10 } }), true);
  assert.equal(isPlacedSurveyMarker({ pageNumber: null, bounds: null }), false);
  assert.equal(isPlacedSurveyMarker({ pageNumber: 1, bounds: null }), false);
  assert.equal(isPlacedSurveyMarker({ pageNumber: null, bounds: { x: 0 } }), false);
  assert.equal(isPlacedSurveyMarker({ pageNumber: 1, bounds: {} }), false); // empty bounds = not placed
  assert.equal(isPlacedSurveyMarker(null), false);
  assert.equal(isPlacedSurveyMarker(undefined), false);
});

test('computeImportDeletionCandidates: a placed marker absent from Excel is NEVER a deletion candidate', () => {
  const surveyMarkers = {
    placed: {
      name: 'Exit Sign',
      moduleId: 'm1',
      categoryId: 'c1',
      pageNumber: 3,
      bounds: { x: 10, y: 20, width: 40, height: 40 },
    },
  };
  // Excel covered this scope but its rows do NOT include "Exit Sign".
  const excelItemsByScope = { 'm1-c1': new Set(['Fire Extinguisher']) };

  const candidates = computeImportDeletionCandidates(surveyMarkers, excelItemsByScope);
  assert.deepEqual(candidates, [], 'placed marker must survive an import that omits it');
});

test('computeImportDeletionCandidates: an UNPLACED app row absent from Excel is still a candidate', () => {
  const surveyMarkers = {
    proposed: {
      name: 'Ghost Row',
      moduleId: 'm1',
      categoryId: 'c1',
      pageNumber: null,
      bounds: null,
    },
  };
  const excelItemsByScope = { 'm1-c1': new Set(['Fire Extinguisher']) };

  const candidates = computeImportDeletionCandidates(surveyMarkers, excelItemsByScope);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].key, 'proposed');
});

test('computeImportDeletionCandidates: markers in scopes Excel did not cover are untouched', () => {
  const surveyMarkers = {
    other: { name: 'Untouched', moduleId: 'm9', categoryId: 'c9', pageNumber: null, bounds: null },
  };
  const excelItemsByScope = { 'm1-c1': new Set(['Anything']) };
  assert.deepEqual(computeImportDeletionCandidates(surveyMarkers, excelItemsByScope), []);
});

test('computeImportDeletionCandidates: a marker still present in Excel is not deleted', () => {
  const surveyMarkers = {
    kept: { name: 'Fire Extinguisher', moduleId: 'm1', categoryId: 'c1', pageNumber: null, bounds: null },
  };
  const excelItemsByScope = { 'm1-c1': new Set(['Fire Extinguisher']) };
  assert.deepEqual(computeImportDeletionCandidates(surveyMarkers, excelItemsByScope), []);
});

test('computeImportDeletionCandidates: protectedIds are never deletion candidates', () => {
  const surveyMarkers = {
    locked: { name: 'Proposed', moduleId: 'm1', categoryId: 'c1', pageNumber: null, bounds: null },
  };
  const excelItemsByScope = { 'm1-c1': new Set(['Other']) };
  const candidates = computeImportDeletionCandidates(surveyMarkers, excelItemsByScope, {
    protectedIds: ['locked'],
  });
  assert.deepEqual(candidates, []);
});

test('computeImportDeletionCandidates: honors spaceId as a moduleId fallback', () => {
  const surveyMarkers = {
    legacy: { name: 'Old', spaceId: 'm1', categoryId: 'c1', pageNumber: null, bounds: null },
  };
  const excelItemsByScope = { 'm1-c1': new Set(['Different']) };
  const candidates = computeImportDeletionCandidates(surveyMarkers, excelItemsByScope);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].key, 'legacy');
});
