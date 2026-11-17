// KAL-771 and KAL-773: a new field user's first Survey.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tapSurveyMarkerBox } from '../src/survey/markerShapes.js';
import { requestTemplateEditor, takeTemplateEditorRequest } from '../src/home/templateEditorRequest.js';

test('a tap places a small square centred on it', () => {
  // A 36 x 24 in sheet: 2.5% of 1728 is 43.2.
  assert.deepEqual(tapSurveyMarkerBox({ x: 1000, y: 800 }, 2592, 1728), { x: 978.4, y: 778.4, width: 43.2, height: 43.2 });
  // A letter page: the 16 floor.
  assert.deepEqual(tapSurveyMarkerBox({ x: 100, y: 100 }, 792, 612), { x: 92, y: 92, width: 16, height: 16 });
  // A huge page: the 48 cap.
  assert.equal(tapSurveyMarkerBox({ x: 5000, y: 5000 }, 10000, 10000).width, 48);
});

test('a tap by the edge keeps the square on the page', () => {
  assert.deepEqual(tapSurveyMarkerBox({ x: 2, y: 611 }, 792, 612), { x: 0, y: 596, width: 16, height: 16 });
  assert.equal(tapSurveyMarkerBox({ x: 1, y: 1 }, 10, 10).width, 10);
});

test('no page, no square', () => {
  assert.equal(tapSurveyMarkerBox(null, 792, 612), null);
  assert.equal(tapSurveyMarkerBox({ x: 1, y: 1 }, 0, 612), null);
});

test('the survey panel can ask Templates for a new template', () => {
  requestTemplateEditor(null, { create: true });
  assert.deepEqual(takeTemplateEditorRequest(), { templateId: null, create: true });
  requestTemplateEditor('t1');
  assert.deepEqual(takeTemplateEditorRequest(), { templateId: 't1', create: false });
  assert.equal(takeTemplateEditorRequest(), null);
});

test('the empty template picker offers New template, and the layer places on a tap', () => {
  const rail = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
  assert.match(rail, /onRequestCreateTemplate\(\{ mode: 'new-template' \}\)/);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /options\?\.mode === 'new-template'/);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /clicked && state\.tool === 'survey-marker' && state\.start/);
});
