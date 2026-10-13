// Review round 9 (2026-10-04): a Shapes / Text tool holding a pick of its own
// group shows the PICKED mark's values in the bar (resolvePickBarTool ->
// 'select'). A drag that draws a NEW mark while that pick is held drew it with
// the picked mark's values: Rectangle set to 8 pt, pick a 2 pt rectangle, drag
// out a new one -> the new one was 2 pt (and in the picked mark's colours),
// while the bar went back to 8 pt right after. Reproduced in Chromium
// (scratchpad review9/pickdraw.mjs). A new mark is always drawn with the
// tool's own settings - the ones saved when the pick began.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveNewMarkStyle } from '../src/utils/toolbarCalloutTarget.js';

const live = {
  strokeColor: '#0000ff', strokeOpacity: 50, fillColor: '#00ff00', fillOpacity: 30, strokeWidth: 2,
  lineBorderStyle: 'dashed', cloudIntensity: 3, arrowheadStyle: 'openArrow', arrowBothEnds: true,
};
const saved = {
  strokeColor: '#ff0000', strokeOpacity: 100, fillColor: '#ffffff', fillOpacity: 0, strokeWidth: 8,
  lineBorderStyle: 'solid', cloudIntensity: 2, arrowheadStyle: 'solidTriangle', arrowBothEnds: false,
};

test('a Shapes tool holding an own-group pick draws a new mark with the tool settings', () => {
  assert.deepEqual(resolveNewMarkStyle({ activeTool: 'rect', pickBarTool: 'select', live, savedToolSettings: saved }), saved);
  assert.deepEqual(resolveNewMarkStyle({ activeTool: 'callout', pickBarTool: 'select', live, savedToolSettings: saved }), saved);
});

test('no pick, a just-drawn pick, Select and Pan: the bar values are the drawing values', () => {
  assert.equal(resolveNewMarkStyle({ activeTool: 'rect', pickBarTool: 'rect', live, savedToolSettings: null }), live);
  // justDrawn keeps pickBarTool on the tool, whose settings restyle it too.
  assert.equal(resolveNewMarkStyle({ activeTool: 'rect', pickBarTool: 'rect', live, savedToolSettings: saved }), live);
  assert.equal(resolveNewMarkStyle({ activeTool: 'select', pickBarTool: 'select', live, savedToolSettings: saved }), live);
  assert.equal(resolveNewMarkStyle({ activeTool: 'pan', pickBarTool: 'select', live, savedToolSettings: saved }), live);
  // The one render before the pick's snapshot exists: still the live values.
  assert.equal(resolveNewMarkStyle({ activeTool: 'rect', pickBarTool: 'select', live, savedToolSettings: null }), live);
});

test('PDFViewer feeds new-mark creation from resolveNewMarkStyle, not the bar state', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /const newMarkStyle = resolveNewMarkStyle\(\{/);
  // The SVG layer (every shape / ink / line preview and commit) ...
  const layer = src.slice(src.indexOf('<SVGAnnotationLayer'), src.indexOf('onSurveyMarkerCreated={getSvgLayerPageHandlers'));
  for (const prop of ['strokeColor', 'strokeOpacity', 'fillColor', 'fillOpacity', 'strokeWidth', 'arrowheadStyle', 'lineBorderStyle', 'cloudIntensity']) {
    assert.match(layer, new RegExp(`\\b${prop}=\\{newMarkStyle\\.${prop}\\}`), `SVGAnnotationLayer ${prop}`);
  }
  assert.match(layer, /arrowStartStyle=\{newMarkStyle\.arrowBothEnds \? newMarkStyle\.arrowheadStyle : null\}/);
  // ... and a new callout.
  const create = src.slice(src.indexOf('const handleCreateCallout = useCallback'), src.indexOf('// UX: Phase 14 CALL-10 (drag MVP)'));
  assert.match(create, /borderColor: newMarkStyle\.strokeColor/);
  assert.match(create, /lineThickness: Math\.max\(1, Number\(newMarkStyle\.strokeWidth\) \|\| 2\)/);
  assert.doesNotMatch(create, /borderColor: strokeColor\b/);
});
