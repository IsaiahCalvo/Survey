import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-vertex-callout-corner-pointercancel.spec.mjs
// Vertex-N / callout textBox-* pointerup already commits. Capturing on the
// knob remounts mid-drag and pointercancel aborted the live preview.
// Capture stays on the SVG so the root handlePointerUp / zoomGeneration
// flush persist. Distinct from leftover-18 / X-01 / selected bbox / nubbin
// / create keep-track / survey-marker discard.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('vertex capture stays on the SVG so pointercancel can commit', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /handleId\.startsWith\('vertex-'\)/);
  const captureAt = hook.indexOf('Vertex knobs remount as previewObjects updates');
  assert.ok(captureAt > 0, 'vertex capture comment');
  const capture = hook.slice(captureAt, captureAt + 900);
  assert.match(capture, /svgRef\.current \|\| e\.target/);
  assert.match(capture, /setPointerCapture/);
  assert.doesNotMatch(hook, /__e2eVertexPointercancel/);
  assert.doesNotMatch(hook, /file\.id/);
});

test('callout-part capture stays on the SVG so corner \/ knee cancel commits', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const calloutAt = hook.indexOf('Callout knee / corner / arrowTip remount on live paint');
  assert.ok(calloutAt > 0, 'callout capture comment');
  const callout = hook.slice(calloutAt, calloutAt + 500);
  assert.match(callout, /svgRef\.current \|\| e\.target/);
  assert.match(callout, /setPointerCapture/);
  assert.match(layer, /onPointerCancel=\{isInteractive \? \(e\) => \{/);
  assert.match(layer, /handlePointerUp\(e\)/);
  assert.doesNotMatch(layer, /handlePointerUpRef/);
  assert.doesNotMatch(layer, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(layer, /VITE_DEV_AUTO_LOGIN/);
});
