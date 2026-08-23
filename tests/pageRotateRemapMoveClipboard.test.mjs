import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for remapped move + Cut/Copy/Paste after page CW.
// Live proof: debug/scenarios/e2e-page-rotate-remap-move-clipboard.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('remapped-move spec covers body-drag + clipboard without a mouse remapper', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-move-clipboard.spec.mjs');
  assert.match(spec, /pointerBodyDrag/);
  assert.match(spec, /undo restores remapped-unmoved/);
  assert.match(spec, /Copy\+Paste must hold remapped original/);
  assert.match(spec, /paste clone must land on rotated page/);
  assert.match(spec, /cut-paste must land on rotated page/);
  assert.match(spec, /empty clipboard Paste invents 0/);
  assert.match(spec, /Escape cancel does not move/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /must not stamp file\.id/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
});

test('SVG viewBox owns zoom; no leftover-portrait pageWidth in move hook', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /mode: 'move'/);
  assert.match(hook, /displayedBoxOrigin/);
  assert.match(hook, /constrainToPage/);
});
