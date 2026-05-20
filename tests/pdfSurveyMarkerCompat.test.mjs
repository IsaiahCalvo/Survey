import test from 'node:test';
import assert from 'node:assert/strict';
import { readSurveyMarkerLayer } from '../src/utils/pdfAppAnnotationMetadata.js';

test('reads the new layer key', () => {
  const parsed = { layers: { surveyMarkers: { a: { annotationId: 'a' } } } };
  assert.deepEqual(readSurveyMarkerLayer(parsed), { a: { annotationId: 'a' } });
});

test('falls back to the legacy layer key', () => {
  const parsed = { layers: { highlightAnnotations: { b: { annotationId: 'b' } } } };
  assert.deepEqual(readSurveyMarkerLayer(parsed), { b: { annotationId: 'b' } });
});

test('prefers the new key when both are present', () => {
  const parsed = { layers: { surveyMarkers: { n: 1 }, highlightAnnotations: { o: 1 } } };
  assert.deepEqual(readSurveyMarkerLayer(parsed), { n: 1 });
});

test('returns an empty object when neither key exists', () => {
  assert.deepEqual(readSurveyMarkerLayer({ layers: {} }), {});
  assert.deepEqual(readSurveyMarkerLayer({}), {});
  assert.deepEqual(readSurveyMarkerLayer(null), {});
});
