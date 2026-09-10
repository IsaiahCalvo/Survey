import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectPendingSurveyMarkerDraftIds,
  buildPendingSurveyMarkerProjection } from '../src/utils/pendingSurveyMarkerHistory.js';

const marker = (annotationId, moduleId = 'module-a', page = 1) => ({
  annotationId, moduleId, x: page * 10, y: 2, width: 3, height: 4,
});

test('model2 drops a peer-deleted prior marker unless its ID is an explicit pending draft', () => {
  const previousByPage = { 1: [marker('left'), marker('right')] };
  const savedMarkers = { right: { moduleId: 'module-a', pageNumber: 1, bounds: { x: 2, y: 2, width: 3, height: 4 } } };
  assert.deepEqual(buildPendingSurveyMarkerProjection({ previousByPage, savedMarkers,
    selectedModuleId: 'module-a', pendingMarkerIds: new Set(), requireExplicitPending: true }), {});
  assert.deepEqual(buildPendingSurveyMarkerProjection({ previousByPage, savedMarkers,
    selectedModuleId: 'module-a', pendingMarkerIds: new Set(['left']), requireExplicitPending: true }),
  { 1: [marker('left')] });
});

test('all three draft workflows contribute IDs while saved navigation never does', () => {
  const ids = collectPendingSurveyMarkerDraftIds({
    pendingSurveyMarker: { id: 'direct-id' },
    pendingEntitySelection: { surveyMarker: { annotationId: 'entity-id' } },
    pendingSurveyMarkerName: { surveyMarker: { id: 'name-id' } },
    pendingSurveyMarkerSelection: { annotationId: 'saved-navigation' },
  });
  assert.deepEqual([...ids].sort(), ['direct-id', 'entity-id', 'name-id']);
});

test('saved canonical IDs win duplicates and module filters apply to pending history', () => {
  const prior = { 1: [marker('saved'), marker('other', 'module-b'), marker('draft'), marker('draft')] };
  const projection = buildPendingSurveyMarkerProjection({ previousByPage: prior,
    savedMarkers: { saved: { moduleId: 'module-a' } }, selectedModuleId: 'module-a',
    pendingMarkerIds: new Set(['saved', 'other', 'draft']), requireExplicitPending: true });
  assert.deepEqual(projection, { 1: [marker('draft')] });
});

test('malformed history and IDs are ignored while model1 keeps old absent-marker inference', () => {
  assert.deepEqual([...collectPendingSurveyMarkerDraftIds({ pendingSurveyMarker: {},
    pendingEntitySelection: { surveyMarker: { id: '' } }, pendingSurveyMarkerName: null })], []);
  const prior = { 1: [marker('legacy')], bad: 'not-an-array' };
  assert.deepEqual(buildPendingSurveyMarkerProjection({ previousByPage: prior, savedMarkers: {},
    selectedModuleId: 'module-a', pendingMarkerIds: new Set(), requireExplicitPending: false }),
  { 1: [marker('legacy')] });
});

test('viewer supplies explicit model2 draft IDs and does not treat saved selection as pending', () => {
  const source = readFileSync('src/PDFViewer.jsx', 'utf8');
  assert.match(source, /collectPendingSurveyMarkerDraftIds\(\{[\s\S]*?pendingSurveyMarker,[\s\S]*?pendingEntitySelection,[\s\S]*?pendingSurveyMarkerName,[\s\S]*?\}\)/);
  assert.match(source, /buildPendingSurveyMarkerProjection\(\{[\s\S]*?requireExplicitPending:\s*checkedBundle\?\.contentModelVersion === 2/);
  assert.doesNotMatch(source, /collectPendingSurveyMarkerDraftIds\(\{[\s\S]{0,300}pendingSurveyMarkerSelection/);
});
