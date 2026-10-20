import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSurveyMarkerPromptName } from '../src/utils/surveyMarkerNamePrompt.js';

test('resolveSurveyMarkerPromptName keeps untouched null as the default', () => {
  assert.equal(resolveSurveyMarkerPromptName(null, 'Door-1'), 'Door-1');
});

test('resolveSurveyMarkerPromptName keeps typed names and trims them', () => {
  assert.equal(resolveSurveyMarkerPromptName('  Custom  ', 'Door-1'), 'Custom');
});

test('resolveSurveyMarkerPromptName falls back when the typed name is blank', () => {
  assert.equal(resolveSurveyMarkerPromptName('', 'Door-1'), 'Door-1');
  assert.equal(resolveSurveyMarkerPromptName('   ', 'Door-1'), 'Door-1');
});
