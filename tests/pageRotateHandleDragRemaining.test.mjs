import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for remapped line/arrow / counter-nubbin /
// survey-marker HANDLE drag after page CW, plus the hit-test verdict
// cites (screenToSVG CTM, live viewBox, no leftover portrait 612).
// Live proof: debug/scenarios/e2e-page-rotate-*-handle-drag.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('endpoint + nubbin + survey-marker drag use live viewBox, not leftover portrait 612x792', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /const svgPoint = screenToSVG\(svgRef\.current, e\.clientX, e\.clientY\);/);
  assert.match(hook, /if \(handleId === 'p1' \|\| handleId === 'p2'\)/);
  assert.match(hook, /mode: 'endpoint'/);
  assert.match(hook, /handleId === 'midpoint'/);

  const math = read('src/utils/svgTransformMath.js');
  assert.match(math, /export function screenToSVG/);
  assert.match(math, /svgElement\.getScreenCTM\(\)/);
  assert.match(math, /point\.matrixTransform\(ctm\.inverse\(\)\)/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /pageWidth: width, pageHeight: height/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);
  assert.doesNotMatch(layer, /pageHeight:\s*792/);
  assert.match(layer, /data-counter-nubbin-handle="true"/);
  assert.match(layer, /handleHandlePointerDown\(e, 'p1'\)/);
  assert.match(layer, /handleHandlePointerDown\(e, 'p2'\)/);
  assert.match(layer, /\(\(e\.clientX - rect\.left\) \/ rect\.width\) \* width/);
});

test('survey-marker remapped handles exist on the live overlay', () => {
  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /data-resize-handle=\{id\}/);
  assert.match(overlay, /stemAttachY = handles\.mt\.y \+ stemSign \* mtStemGap/);
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /onHandleDrag=\{\(e, handleId\) => handleHandlePointerDown\(e, handleId\)\}/);
});

test('line handle-drag spec records harness-only hit-test verdict, not a mouse remapper', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-line-handle-drag.spec.mjs');
  assert.match(spec, /verdict = \(/);
  assert.match(spec, /harness-only/);
  assert.match(spec, /leftoverPortraitCount/);
  assert.match(spec, /ctmOk/);
  assert.match(spec, /onPage/);
  assert.match(spec, /dragHandlePointer/);
  assert.match(spec, /dragHandleMouse/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
  assert.match(spec, /new PointerEvent/);
  assert.match(spec, /must not stamp file\.id/);
  assert.match(spec, /0 0 792 612/);
});

test('counter + survey-marker remapped handle-drag specs use PointerEvents', () => {
  const counter = read('debug/scenarios/e2e-page-rotate-counter-nubbin-handle-drag.spec.mjs');
  const marker = read('debug/scenarios/e2e-page-rotate-survey-marker-handle-drag.spec.mjs');
  assert.match(counter, /data-counter-nubbin-handle="true"/);
  assert.match(counter, /new PointerEvent/);
  assert.match(counter, /undo must restore remapped nubbin/);
  assert.match(marker, /data-resize-handle="br"/);
  assert.match(marker, /new PointerEvent/);
  assert.match(marker, /undo must restore remapped br/);
  assert.match(counter, /file\.id/);
  assert.match(marker, /file\.id/);
});
