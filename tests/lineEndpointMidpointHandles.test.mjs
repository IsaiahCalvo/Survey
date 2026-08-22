import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveMidpointFromPointer,
  shouldRevertEndpointCurve,
  applyMidpointToAnnotation,
  clearMidpointFromAnnotation,
  resolveMidpointHandlePosition,
} from '../src/utils/lineDragMath.js';
import { getLineEndpoints } from '../src/utils/svgBoundingBox.js';

// Line/arrow single-click chrome leftover after S-03/S-04 create + E-01 bbox
// resize: p1 / p2 endpoint drag + midpoint bend / snap-to-straight.
// Live proof: debug/scenarios/e2e-line-endpoint-midpoint.spec.mjs
// Callout corners stay T-02. Shape br/tl/mr stay E-01. No mid-edge textBox-*.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function fabricLine({ x1, y1, x2, y2, midpoint = null, tool = 'line' }) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const cx = left + width / 2;
  const cy = top + height / 2;
  return {
    type: 'line',
    tool,
    left,
    top,
    width,
    height,
    x1: x1 - cx,
    y1: y1 - cy,
    x2: x2 - cx,
    y2: y2 - cy,
    data: midpoint ? { midpoint: { ...midpoint }, id: 'line-1' } : { id: 'line-1' },
  };
}

test('p2 drag moves that endpoint; p1 stays; midpoint handle is geometric until bent', () => {
  const obj = fabricLine({ x1: 100, y1: 200, x2: 300, y2: 200 });
  const ep = getLineEndpoints(obj);
  assert.equal(ep.x1, 100);
  assert.equal(ep.y1, 200);
  assert.equal(ep.x2, 300);
  assert.equal(ep.y2, 200);

  const mid = resolveMidpointHandlePosition(
    { x: ep.x1, y: ep.y1 },
    { x: ep.x2, y: ep.y2 },
    obj.data.midpoint,
  );
  assert.equal(mid.x, 200);
  assert.equal(mid.y, 200);

  const afterP2 = fabricLine({ x1: 100, y1: 200, x2: 360, y2: 240 });
  const next = getLineEndpoints(afterP2);
  assert.equal(next.x1, 100, 'p1 stays');
  assert.equal(next.y1, 200, 'p1 stays');
  assert.equal(next.x2, 360);
  assert.equal(next.y2, 240);
});

test('midpoint drag writes curve; 10px release snaps straight; endpoint preserve + collinear revert', () => {
  const originalMid = { x: 200, y: 200 };
  const bent = deriveMidpointFromPointer({ x: 200, y: 200 }, { x: 200, y: 260 }, originalMid);
  assert.equal(bent.x, 200);
  assert.equal(bent.y, 260);

  const curved = fabricLine({ x1: 100, y1: 200, x2: 300, y2: 200, midpoint: bent });
  applyMidpointToAnnotation(curved, bent);
  assert.equal(curved.data.midpoint.y, 260);
  assert.equal(
    resolveMidpointHandlePosition({ x: 100, y: 200 }, { x: 300, y: 200 }, curved.data.midpoint).y,
    260,
  );

  const snapBack = deriveMidpointFromPointer({ x: 200, y: 260 }, { x: 200, y: 206 }, bent);
  assert.equal(shouldRevertEndpointCurve(snapBack, { x: 100, y: 200 }, { x: 300, y: 200 }, 10), true);
  clearMidpointFromAnnotation(curved);
  assert.equal(curved.data.midpoint, undefined);

  const keepCurve = { x: 200, y: 250 };
  assert.equal(shouldRevertEndpointCurve(keepCurve, { x: 100, y: 200 }, { x: 360, y: 200 }, 10), false);
  assert.equal(shouldRevertEndpointCurve({ x: 200, y: 204 }, { x: 80, y: 200 }, { x: 400, y: 200 }, 10), true);
});

test('SVG + hook: p1/p2/midpoint wiring; no callout mid-edge; viewBox owns zoom', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  const layer = read('src/components/SVGAnnotationLayer.jsx');

  assert.match(layer, /data-handle="midpoint"/);
  assert.match(layer, /handleHandlePointerDown\(e, 'p1'\)/);
  assert.match(layer, /handleHandlePointerDown\(e, 'p2'\)/);
  assert.match(layer, /handleHandlePointerDown\(e, 'midpoint'\)/);
  assert.doesNotMatch(layer, /data-callout-part="textBox-(mt|ml|mb|mr)"/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));

  assert.match(hook, /if \(handleId === 'midpoint'\)/);
  assert.match(hook, /mode: 'midpoint'/);
  assert.match(hook, /if \(handleId === 'p1' \|\| handleId === 'p2'\)/);
  assert.match(hook, /mode: 'endpoint'/);
  assert.match(hook, /originalMidpoint/);
  assert.match(hook, /shouldRevertEndpointCurve|shouldSnapToLinear/);
});
