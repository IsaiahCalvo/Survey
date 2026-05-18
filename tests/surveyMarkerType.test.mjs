import test from 'node:test';
import assert from 'node:assert/strict';
import { SURVEY_MARKER_TYPE, isSurveyMarkerType } from '../src/utils/surveyMarkerType.js';

test('canonical type is survey-marker', () => {
  assert.equal(SURVEY_MARKER_TYPE, 'survey-marker');
});

test('isSurveyMarkerType accepts the new value', () => {
  assert.equal(isSurveyMarkerType('survey-marker'), true);
});

test('isSurveyMarkerType still accepts the legacy value', () => {
  assert.equal(isSurveyMarkerType('highlight'), true);
});

test('isSurveyMarkerType rejects other types', () => {
  assert.equal(isSurveyMarkerType('callout'), false);
  assert.equal(isSurveyMarkerType('counter'), false);
  assert.equal(isSurveyMarkerType(null), false);
  assert.equal(isSurveyMarkerType(undefined), false);
});
