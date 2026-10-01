import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const SVG_SOURCE = readFileSync(
  new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
  'utf8',
);
const MOBILE_CSS = readFileSync(
  new URL('../src/mobile/mobilePdfViewer.css', import.meta.url),
  'utf8',
);

// Owner 2026-10-01: selecting a Survey Marker must never show a floating
// Delete chip beside it. Delete stays on the long-press / right-click menu,
// the Delete key and the Survey panel.
test('a selected Survey Marker draws no floating Delete chip', () => {
  assert.doesNotMatch(SVG_SOURCE, /survey-marker-touch-delete/);
  assert.doesNotMatch(SVG_SOURCE, /aria-label="Delete Survey Marker"/);
  assert.doesNotMatch(SVG_SOURCE, /selectedSurveyMarkerDeleteBounds/);
  assert.doesNotMatch(MOBILE_CSS, /survey-marker-touch-delete/);
});

test('the Delete key still deletes the selected Survey Marker', () => {
  assert.match(SVG_SOURCE, /flushPendingNudges\(\);\s*deleteSelectedSurveyMarker\(\);/);
  assert.match(SVG_SOURCE, /onDeleteSurveyMarkers\(ids\)/);
});
