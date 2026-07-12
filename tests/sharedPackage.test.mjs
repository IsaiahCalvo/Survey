import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const surveyMarker = require('../packages/shared/dist/surveyMarker.js');
const annotationTypes = require('../packages/shared/dist/annotationTypes.js');
const geometry = require('../packages/shared/dist/geometry.js');
const survey = require('../packages/shared/dist/survey.js');
const sharedIndex = require('../packages/shared/dist/index.js');

test('shared surveyMarker recognizes current and legacy types', () => {
  assert.equal(surveyMarker.SURVEY_MARKER_TYPE, 'survey-marker');
  assert.equal(surveyMarker.LEGACY_SURVEY_MARKER_TYPE, 'highlight');
  assert.deepEqual(surveyMarker.SURVEY_MARKER_TYPE_VALUES, ['survey-marker', 'highlight']);
  assert.equal(surveyMarker.isSurveyMarkerType('survey-marker'), true);
  assert.equal(surveyMarker.isSurveyMarkerType('highlight'), true);
  assert.equal(surveyMarker.isSurveyMarkerType('ink'), false);
  assert.equal(surveyMarker.isSurveyMarkerType(null), false);
});

test('shared annotationTypes exposes the supported DB vocabulary', () => {
  assert.ok(annotationTypes.ANNOTATION_TYPES.includes('callout'));
  assert.equal(annotationTypes.isSupportedAnnotationType('ink'), true);
  assert.equal(annotationTypes.isSupportedAnnotationType('not-a-type'), false);
  assert.equal(annotationTypes.SUPPORTED_DB_TYPES.has('counter'), true);
});

test('shared type-only modules and barrel export load', () => {
  assert.equal(typeof geometry, 'object');
  assert.equal(typeof survey, 'object');
  assert.equal(sharedIndex.isSurveyMarkerType('highlight'), true);
  assert.equal(sharedIndex.isSupportedAnnotationType('stamp'), true);
});
