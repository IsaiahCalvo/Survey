import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('P1-16: survey-marker paint effect no longer early-returns when no module is selected', () => {
  const start = VIEWER_SOURCE.indexOf('// Restore surveyMarkers when switching modules');
  assert.ok(start > -1);
  const body = VIEWER_SOURCE.slice(start, start + 3500);
  assert.equal(body.includes("if (!selectedModuleId) {\n      // Don't clear surveyMarkers"), false);
  assert.match(body, /const matchesSelectedModule = \(moduleId\) => \(/);
  assert.match(body, /!selectedModuleId \|\| moduleId === selectedModuleId/);
  assert.match(body, /if \(!matchesSelectedModule\(surveyMarkerModuleId\)\)/);
});

test('P1-24: survey-marker move/resize does not skip the ownership gate when owner id is unresolved', () => {
  const start = VIEWER_SOURCE.indexOf('const handleSurveyMarkerBoundsChange = useCallback');
  assert.ok(start > -1);
  const body = VIEWER_SOURCE.slice(start, start + 1800);
  assert.match(body, /canModifySurveyMarker\(\{ surveyMarker: existingSurveyMarker, viewerId, documentOwnerId \}\)/);
  assert.equal(/\n\s*viewerId &&\n\s*documentOwnerId &&\n/.test(body), false);
});
