import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLogPreamble } from '../src/utils/logPreamble.js';

test('buildLogPreamble includes header fields and optional description', () => {
  const text = buildLogPreamble({ description: '  bug report  ' });
  assert.match(text, /# Description: bug report/);
  assert.match(text, /===== SurveyApp Save Log =====/);
  assert.match(text, /version:/);
  assert.match(text, /runtime:/);
  assert.match(text, /platform:/);
  assert.match(text, /timestamp:/);
});

test('buildLogPreamble works without description', () => {
  const text = buildLogPreamble();
  assert.doesNotMatch(text, /# Description:/);
  assert.match(text, /SurveyApp Save Log/);
});
