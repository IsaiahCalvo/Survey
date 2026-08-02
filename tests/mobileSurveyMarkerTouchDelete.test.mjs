import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const SVG_SOURCE = readFileSync(
  new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
  'utf8',
);

test('mobile Survey Marker Delete has one pointer activation path and keyboard activation', () => {
  const start = SVG_SOURCE.indexOf('className="survey-marker-touch-delete"');
  const end = SVG_SOURCE.indexOf('{filteredCallouts}', start);
  const control = SVG_SOURCE.slice(start, end);

  assert.ok(start > -1, 'touch Delete control is rendered');
  assert.match(control, /role="button"/);
  assert.match(control, /aria-label="Delete Survey Marker"/);
  assert.match(control, /onPointerUp=/);
  assert.match(control, /onKeyDown=/);
  assert.doesNotMatch(control, /onClick=/, 'touch release must not also synthesize a second delete');
  assert.equal((control.match(/deleteSelectedSurveyMarker\(\)/g) || []).length, 2);
});
