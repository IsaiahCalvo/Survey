import test from 'node:test';
import assert from 'node:assert/strict';

import { compareSurveyMarkersForOrder } from '../src/utils/surveyMarkerOrdering.js';

test('compareSurveyMarkersForOrder prefers custom surveyMarkerOrder', () => {
  assert.ok(compareSurveyMarkersForOrder(
    { surveyMarkerOrder: 2, id: 'b' },
    { surveyMarkerOrder: 1, id: 'a' },
  ) > 0);
  assert.equal(compareSurveyMarkersForOrder(
    { surveyMarkerOrder: 1, id: 'b' },
    { id: 'a' },
  ), -1);
  assert.equal(compareSurveyMarkersForOrder(
    { id: 'a' },
    { surveyMarkerOrder: 1, id: 'b' },
  ), 1);
});

test('compareSurveyMarkersForOrder falls back to excelRowIndex then id', () => {
  assert.ok(compareSurveyMarkersForOrder(
    { excelRowIndex: 5, id: 'z' },
    { excelRowIndex: 2, id: 'a' },
  ) > 0);
  assert.equal(compareSurveyMarkersForOrder(
    { excelRowIndex: 2, id: 'z' },
    { id: 'a' },
  ), -1);
  assert.equal(compareSurveyMarkersForOrder(
    { id: 'a' },
    { excelRowIndex: 2, id: 'z' },
  ), 1);
  assert.ok(compareSurveyMarkersForOrder({ id: 'b' }, { id: 'a' }) > 0);
  assert.equal(compareSurveyMarkersForOrder({}, {}), 0);
});

test('compareSurveyMarkersForOrder ignores non-finite order values', () => {
  assert.ok(compareSurveyMarkersForOrder(
    { surveyMarkerOrder: 'nope', id: 'b' },
    { surveyMarkerOrder: 'also-nope', id: 'a' },
  ) > 0);
});
