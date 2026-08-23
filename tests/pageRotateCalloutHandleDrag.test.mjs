import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateCalloutFractions,
  rotateNormalizedPoint,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for remapped callout HANDLE drag after page CW.
// Distinct from placement-only pageRotateCalloutRemap and unrotated
// calloutKneeDrag (portrait viewBox; cheap rotate-then-drag parked).
// Live proof: debug/scenarios/e2e-page-rotate-callout-handle-drag.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const CALLOUT = {
  id: 'callout-xf-drag',
  arrowTip: { x: 0.16, y: 0.22 },
  knee: { x: 0.22, y: 0.28 },
  textBoxPosition: { x: 0.44, y: 0.42 },
  textBoxWidth: 120 / 612,
  textBoxHeight: 32 / 792,
};

test('callout-part drag normalizes by live viewBox, not leftover portrait 612x792', () => {
  const leftoverW = 612;
  const leftoverH = 792;
  const liveW = 792;
  const liveH = 612;
  const dxPage = 79.2;
  const dyPage = 61.2;
  const leftoverNorm = { x: dxPage / leftoverW, y: dyPage / leftoverH };
  const liveNorm = { x: dxPage / liveW, y: dyPage / liveH };
  assert.ok(Math.abs(leftoverNorm.x - liveNorm.x) > 0.02, 'leftover W would inflate dxNorm');
  assert.ok(Math.abs(leftoverNorm.y - liveNorm.y) > 0.02, 'leftover H would shrink dyNorm');

  const remappedKnee = rotateNormalizedPoint(CALLOUT.knee, leftoverW, leftoverH, 90);
  const afterLive = { x: remappedKnee.x + liveNorm.x, y: remappedKnee.y + liveNorm.y };
  const afterLeftover = { x: remappedKnee.x + leftoverNorm.x, y: remappedKnee.y + leftoverNorm.y };
  assert.ok(Math.abs(afterLive.x - afterLeftover.x) > 0.02);
  assert.ok(afterLive.x > 0 && afterLive.x < 1);
  assert.ok(afterLive.y > 0 && afterLive.y < 1);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /const W = pageWidth \|\| 1;/);
  assert.match(hook, /const H = pageHeight \|\| 1;/);
  assert.match(hook, /const dxNorm = dxPage \/ W;/);
  assert.match(hook, /const dyNorm = dyPage \/ H;/);
  assert.match(hook, /case 'arrowTip':/);
  assert.match(hook, /case 'knee':/);
  assert.match(hook, /case 'textBox':/);
  assert.match(hook, /mode === 'callout-part'/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /pageWidth: width, pageHeight: height/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);
  assert.doesNotMatch(layer, /pageHeight:\s*792/);
});

test('remapper still swaps callout fractions onto 792x612; handle drag is a later path', () => {
  const remapped = rotateCalloutFractions(CALLOUT, 612, 792, 90);
  const expectedKnee = rotateNormalizedPoint(CALLOUT.knee, 612, 792, 90);
  assert.ok(Math.abs(remapped.knee.x - expectedKnee.x) < 1e-9);
  assert.ok(Math.abs(remapped.knee.y - expectedKnee.y) < 1e-9);
  assert.notEqual(remapped.knee.x, CALLOUT.knee.x);
  assert.equal(rotateCalloutFractions(null, 612, 792, 90), null);
});

test('layer emits remapped handles; Pen intercepts before callout-part drag', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(layer, /data-callout-part="knee"/);
  assert.match(layer, /data-callout-part="arrowTip"/);
  assert.match(renderers, /data-callout-part="textBox"/);
  const penIdx = layer.indexOf('if ((isShapeCreationTool || isFreehandCreationTool)');
  const svgDownIdx = layer.lastIndexOf('handleSvgPointerDown(e)');
  assert.ok(penIdx > 0 && svgDownIdx > penIdx, 'Pen intercepts before remapped handle drag');

  const spec = read('debug/scenarios/e2e-page-rotate-callout-handle-drag.spec.mjs');
  assert.match(spec, /must not stamp file\.id/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /new PointerEvent/);
  assert.doesNotMatch(spec, /file\.id\s*=\s*['"]/);
});
