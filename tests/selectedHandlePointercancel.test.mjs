import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-selected-handle-pointercancel.spec.mjs
// Selected bbox / mtr / endpoint / midpoint / knee pointerup already commits.
// pointercancel left visualTransform armed and stored geometry stale;
// zoomGeneration did not flush. Distinct from leftover-18 / X-01 / nubbin
// / create keep-track / eraser commit / survey-marker discard.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('useSVGInteraction flushes in-flight selected-handle drag on zoomGeneration', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /zoomGeneration = 0,/);
  assert.match(hook, /ds\.lastClientX = e\.clientX/);
  assert.match(hook, /ds\.lastClientY = e\.clientY/);
  const flushAt = hook.indexOf('// zoomGeneration contract: an in-flight selected-handle drag must persist');
  assert.ok(flushAt > 0, 'selected-handle zoomGeneration comment');
  const flush = hook.slice(flushAt, hook.indexOf('const handleHandlePointerDown', flushAt));
  assert.match(flush, /if \(!ds\?\.active\) return/);
  assert.match(flush, /handlePointerUp\(/);
  assert.match(flush, /ds\.lastClientX/);
  assert.match(hook, /window\.addEventListener\('pointercancel', onCancel\)/);
  assert.doesNotMatch(flush, /setVisualTransform\(null\);[\s\S]*handlePointerUp/);
  assert.doesNotMatch(hook, /__e2eSelectedHandlePointercancel/);
  assert.doesNotMatch(hook, /file\.id/);
});

test('SVGAnnotationLayer pointercancel commits selected-handle preview, discards survey-marker', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /zoomGeneration,/);
  const cancelAt = layer.indexOf('onPointerCancel={isInteractive ? (e) => {');
  assert.ok(cancelAt > 0, 'root pointercancel');
  const cancel = layer.slice(cancelAt, layer.indexOf('onDoubleClick=', cancelAt));
  assert.match(cancel, /if \(surveyMarkerDragRef\.current\)/);
  assert.match(cancel, /setSurveyMarkerPreviewBounds\(null\)/);
  assert.match(cancel, /handlePointerUp\(e\)/);
  assert.match(cancel, /return;/);
  const nubbinAt = layer.indexOf('onPointerCancel={() => {');
  assert.ok(nubbinAt > cancelAt, 'nubbin cancel stays its own path');
  const nubbin = layer.slice(nubbinAt, layer.indexOf('</g>', nubbinAt));
  assert.match(nubbin, /commitCounterHandlePreview\(preview\)/);
  assert.doesNotMatch(layer, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(layer, /VITE_DEV_AUTO_LOGIN/);
});
