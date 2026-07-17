import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderPathToSvgAttrs,
  isFilledInkOutlineAttrs,
  getFilledInkHitTargetProps,
} from '../src/utils/svgPathAttrs.js';

// Shaped like createProductionPaperInk output (src/utils/productionPaperInk.js):
// filled outline polygon, no painted stroke.
const paperInkObject = {
  type: 'path',
  tool: 'pen',
  path: [['M', 0, 0], ['L', 30, 4], ['L', 30, 8], ['L', 0, 4], ['Z']],
  paperInkGeometry: 'v1',
  fillRule: 'evenodd',
  fill: '#ff0000',
  stroke: 'transparent',
  strokeWidth: 0,
  sourceWidth: 8,
};

const eraserCarvedInkObject = {
  ...paperInkObject,
  fillRule: undefined,
  paperEraserGeometry: 'v1',
};

const plainStrokedPath = {
  type: 'path',
  path: [['M', 0, 0], ['Q', 10, 10, 20, 0]],
  stroke: '#0000ff',
  strokeWidth: 3,
  fill: 'none',
};

test('native paper ink yields interior-hit props (pointer-events all + fill + boundary band)', () => {
  const attrs = renderPathToSvgAttrs(paperInkObject);
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.fillRule, 'evenodd');
  assert.equal(attrs.stroke, 'none');
  assert.equal(isFilledInkOutlineAttrs(attrs), true);

  const props = getFilledInkHitTargetProps(attrs, { strokeWidth: 1, inverseScale: 1 });
  assert.ok(props);
  assert.equal(props.pointerEvents, 'all');
  assert.equal(props.fill, 'rgba(0,0,0,0.001)');
  assert.equal(props.fillRule, 'evenodd');
  // KEEPS a transparent boundary stroke band so hairline strokes stay
  // grabbable — same min-12 / 3*inverseScale contract as plain pen paths.
  assert.equal(props.stroke, 'rgba(0,0,0,0.001)');
  assert.ok(props.strokeWidth >= 12);
  // Screen-constant tolerance floor: band grows with inverseScale on zoom-out.
  const zoomedOut = getFilledInkHitTargetProps(attrs, { strokeWidth: 1, inverseScale: 8 });
  assert.equal(zoomedOut.strokeWidth, 24);
});

test('eraser-carved ink (paperEraserGeometry v1) gets the same interior-hit props', () => {
  const attrs = renderPathToSvgAttrs(eraserCarvedInkObject);
  assert.equal(attrs.filledOutline, true);
  assert.equal(isFilledInkOutlineAttrs(attrs), true);
  const props = getFilledInkHitTargetProps(attrs, { strokeWidth: 1, inverseScale: 1 });
  assert.equal(props.pointerEvents, 'all');
  assert.equal(props.fillRule, 'evenodd');
});

test('imported-PDF ink behavior unchanged (smoothClosedOutline branch)', () => {
  // Attrs shape produced by the imported-ink branch of renderPathToSvgAttrs.
  const attrs = {
    stroke: 'none',
    strokeWidth: 0,
    fill: '#00ff00',
    fillRule: 'nonzero',
    filledOutline: true,
    smoothClosedOutline: true,
  };
  assert.equal(isFilledInkOutlineAttrs(attrs), true);
  const props = getFilledInkHitTargetProps(attrs, { strokeWidth: 1, inverseScale: 1 });
  assert.equal(props.pointerEvents, 'all');
  assert.equal(props.fill, 'rgba(0,0,0,0.001)');
  // Imported ink keeps its pre-existing hairline hit contract: no boundary
  // band, sub-pixel stroke width floor.
  assert.equal(props.stroke, 'none');
  assert.equal(props.strokeWidth, 0.75);
});

test('plain unfilled stroked path stays stroke-only (no interior hit props)', () => {
  const attrs = renderPathToSvgAttrs(plainStrokedPath);
  assert.notEqual(attrs.stroke, 'none');
  assert.equal(isFilledInkOutlineAttrs(attrs), false);
  assert.equal(getFilledInkHitTargetProps(attrs, { strokeWidth: 3, inverseScale: 1 }), null);
});
