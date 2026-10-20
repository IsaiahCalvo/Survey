import test from 'node:test';
import assert from 'node:assert/strict';

import { surveyMarkerSyncDiag } from '../src/services/surveyMarkerSyncDiag.js';

test('surveyMarkerSyncDiag stays silent unless explicitly enabled', () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args);
  globalThis.window = { __currentPdfName: 'A.pdf' };
  try {
    surveyMarkerSyncDiag('push.upsert', { n: 1 });
    assert.equal(logs.length, 0);
    globalThis.window.__surveyMarkerSyncDiag = true;
    surveyMarkerSyncDiag('render.survey', { n: 2 });
    assert.equal(logs.length, 1);
    assert.match(String(logs[0][0]), /\[SURVEY-MARKER-SYNC\]\[render\.survey\]\[pdf=A\.pdf\]/);
  } finally {
    console.log = originalLog;
    delete globalThis.window;
  }
});

test('surveyMarkerSyncDiag no-ops without window', () => {
  const original = globalThis.window;
  delete globalThis.window;
  assert.doesNotThrow(() => surveyMarkerSyncDiag('load.legacy'));
  globalThis.window = original;
});
