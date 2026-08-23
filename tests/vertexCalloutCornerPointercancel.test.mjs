import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-vertex-callout-corner-pointercancel.spec.mjs
// Vertex-N / callout textBox-* pointerup already commits. pointercancel on
// the captured knob left the live preview armed and stored geometry stale;
// the SVG root handler does not see captured-pointer cancel. Distinct from
// leftover-18 / X-01 / selected bbox / nubbin / create keep-track /
// survey-marker discard.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('vertex knobs commit pointercancel via handlePointerUp', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const vertexAt = layer.indexOf('data-handle={`vertex-${i}`}');
  assert.ok(vertexAt > 0, 'vertex handle seam');
  const vertex = layer.slice(vertexAt, layer.indexOf('</g>', vertexAt));
  assert.match(vertex, /handleHandlePointerDown\(e, `vertex-\$\{i\}`\)/);
  assert.match(vertex, /onPointerCancel=\{handlePointerUp\}/);
  assert.doesNotMatch(layer, /__e2eVertexPointercancel/);
  assert.doesNotMatch(layer, /file\.id/);
});

test('callout knee / arrowTip / textBox corners commit pointercancel', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /const handlePointerUpRef = useRef\(handlePointerUp\)/);
  assert.match(layer, /handlePointerUpRef\.current = handlePointerUp/);
  const arrowAt = layer.indexOf('data-callout-part="arrowTip"');
  const kneeAt = layer.indexOf('data-callout-part="knee"');
  const cornerAt = layer.indexOf('data-callout-part={`textBox-${p.id}`}');
  assert.ok(arrowAt > 0 && kneeAt > arrowAt && cornerAt > kneeAt, 'callout part order');
  const arrow = layer.slice(arrowAt, kneeAt);
  const knee = layer.slice(kneeAt, cornerAt);
  const corner = layer.slice(cornerAt, layer.indexOf('</g>', cornerAt));
  assert.match(arrow, /onPointerCancel=\{\(e\) => handlePointerUpRef\.current\(e\)\}/);
  assert.match(knee, /onPointerCancel=\{\(e\) => handlePointerUpRef\.current\(e\)\}/);
  assert.match(corner, /onPointerCancel=\{\(e\) => handlePointerUpRef\.current\(e\)\}/);
  assert.doesNotMatch(layer, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(layer, /VITE_DEV_AUTO_LOGIN/);
});
