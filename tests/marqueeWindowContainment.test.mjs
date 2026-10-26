/**
 * Window (left-to-right) marquee must agree with what the user sees.
 *
 * 2026-10-26 (owner, SE-011 Security Shop Drawing): select-all with a
 * left-to-right box + Cmd+X left a purple pen stroke behind; right-to-left
 * caught it. Center-v1 pen strokes keep their path in local coordinates around
 * pathOffset, and the window test placed them with a bare (left, top) matrix,
 * so their bounds landed hundreds of points from where they draw.
 *
 * The guard below is per annotation KIND, built from the real marks on that
 * page (one of each shape the document holds). For every kind: a box drawn
 * snugly around the drawn mark (its world box plus half its visible stroke)
 * must catch it in BOTH directions, and a box that cuts off a slice of it must
 * not catch it in window mode. A new kind whose window bounds drift from its
 * rendered position fails here instead of silently escaping cut/copy/delete.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarqueeHits } from '../src/utils/marqueeSelection.js';
import { getAnnotationWorldAABB } from '../src/utils/svgBoundingBox.js';

// The SE-011 pen dot as stored (center-v1, local path around pathOffset,
// scaled by a later resize). Its path is a 25-pt-radius circle polygon.
const circlePath = (cx, cy, r, steps = 36) => {
  const path = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    path.push([i === 0 ? 'M' : 'L', cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  path.push(['Z']);
  return path;
};

const centerV1Pen = (overrides = {}) => ({
  type: 'path',
  id: '422d0ba8-bbbe-44e8-9f7e-003953d96019',
  tool: 'pen',
  data: { id: '422d0ba8', tool: 'pen', inkGeometrySpace: 'local', inkGeometryOrigin: 'center-v1' },
  polygons: '~polygons-from-path:v1',
  paperCenterline: [{ x: 503.36094674556205, y: 292.1974708866185 }],
  paperInkGeometry: 'v1',
  fillRule: 'evenodd',
  fill: '#7c3aed',
  stroke: 'transparent',
  strokeWidth: 0,
  sourceWidth: 50,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  originX: 'center',
  originY: 'center',
  inkGeometrySpace: 'local',
  inkGeometryOrigin: 'center-v1',
  left: 450.21770609383657,
  top: 365.5963670010922,
  width: 50,
  height: 50,
  path: circlePath(503.36094674556205, 292.1974708866185, 25),
  pathOffset: { x: 503.36094674556205, y: 292.1974708866185 },
  scaleX: 0.7701697364448705,
  scaleY: 0.8112594157641979,
  angle: 0,
  ...overrides,
});

const KINDS = {
  'pen (center-v1, resized)': centerV1Pen(),
  'pen (center-v1, plain)': centerV1Pen({ scaleX: 1, scaleY: 1 }),
  'pen (center-v1, rotated)': centerV1Pen({ angle: 30 }),
  'highlighter (center-v1)': centerV1Pen({ tool: 'highlighter', fill: 'rgba(255, 193, 7, 0.3)', left: 356.67, top: 336.95 }),
  'pen (legacy page-space)': {
    type: 'path', tool: 'pen', data: { tool: 'pen' }, polygons: '~polygons-from-path:v1',
    paperInkGeometry: 'v1', fill: '#000000', stroke: 'transparent', strokeWidth: 0,
    left: 0, top: 0, width: 50, height: 50, scaleX: 1, scaleY: 1, angle: 0,
    path: circlePath(836.5207100591714, 335.5970565121097, 25),
  },
  rect: {
    type: 'Rect', originX: 'left', originY: 'top', left: 221.32, top: 175.24, width: 193.84, height: 124.72,
    fill: 'rgba(255, 255, 255, 0)', stroke: 'rgba(255, 0, 0, 1)', strokeWidth: 2, strokeUniform: true,
    scaleX: 1, scaleY: 1, angle: 0, data: { strokeRenderContract: 'drawn-centered-stroke' },
  },
  'rect (resized)': {
    type: 'Rect', originX: 'left', originY: 'top', left: 790.73, top: 285.22, width: 218.32, height: 140.56,
    fill: 'rgba(255, 255, 255, 0)', stroke: 'rgba(255, 0, 0, 1)', strokeWidth: 2, strokeUniform: true,
    scaleX: 0.424136, scaleY: 0.461189, angle: 0, data: { strokeRenderContract: 'drawn-centered-stroke' },
  },
  ellipse: {
    type: 'Ellipse', originX: 'left', originY: 'top', left: 278.96, top: 513.43, width: 234.42, height: 171.66,
    rx: 117.21, ry: 85.83, fill: 'rgba(255, 255, 255, 0)', stroke: 'rgba(255, 0, 0, 1)', strokeWidth: 2,
    strokeUniform: true, scaleX: 1, scaleY: 1, angle: 0, data: { strokeRenderContract: 'drawn-centered-stroke' },
  },
  arrow: {
    type: 'Line', tool: 'arrow', originX: 'left', originY: 'top', left: 159.78, top: 705.09, width: 228.19, height: 0,
    x1: -114.09411057692307, y1: 0, x2: 114.09411057692313, y2: 0, stroke: 'rgba(255, 0, 0, 1)',
    strokeWidth: 2, strokeUniform: true, scaleX: 1, scaleY: 1, angle: 0, data: { arrowheadStyle: 'solidTriangle' },
  },
  line: {
    type: 'Line', tool: 'line', originX: 'left', originY: 'top', left: 996.52, top: 220.75, width: 0, height: 147.59,
    x1: 0, y1: -73.79715798272491, x2: 0, y2: 73.79715798272491, stroke: 'rgba(255, 0, 0, 1)',
    strokeWidth: 2, strokeUniform: true, scaleX: 1, scaleY: 1, angle: 0, data: {},
  },
  polyline: {
    type: 'polyline', originX: 'left', originY: 'top', left: 414.47, top: 297.14, width: 75.02, height: 9.96,
    points: [{ x: 0, y: 0 }, { x: 75.02, y: 9.96 }], pathOffset: { x: 0, y: 0 }, fill: 'transparent',
    stroke: 'rgba(255, 0, 0, 1)', strokeWidth: 2, strokeUniform: true, scaleX: 1, scaleY: 1, angle: 0, data: {},
  },
  'polyline (resized)': {
    type: 'polyline', originX: 'left', originY: 'top', left: 461.97, top: 370.77, width: 59.93, height: 58.97,
    points: [{ x: 0, y: 0 }, { x: 59.93, y: 58.97 }], pathOffset: { x: 0, y: 0 }, fill: 'transparent',
    stroke: 'rgba(255, 0, 0, 1)', strokeWidth: 2, strokeUniform: true, scaleX: 0.77017, scaleY: 0.811259, angle: 0, data: {},
  },
  'polygon (thick, resized)': {
    type: 'polygon', originX: 'left', originY: 'top', left: 723.94, top: 324.09, width: 321.79, height: 399.19,
    points: [
      { x: 0, y: 97.91 }, { x: 77.69, y: 0 }, { x: 186.79, y: 40.44 }, { x: 291.28, y: 156.65 },
      { x: 321.79, y: 347.06 }, { x: 201.02, y: 399.19 }, { x: 201.02, y: 294.61 }, { x: 75.08, y: 294.61 },
    ],
    pathOffset: { x: 0, y: 0 }, fill: 'rgba(255, 0, 0, 1)', stroke: 'rgba(239, 68, 68, 1)', strokeWidth: 14,
    strokeUniform: true, scaleX: 0.801889, scaleY: 0.760034, angle: 0, data: {},
  },
  'polygon (dashed)': {
    type: 'polygon', originX: 'left', originY: 'top', left: 102.5, top: 370.57, width: 157.29, height: 225.45,
    points: [
      { x: 0, y: 16.68 }, { x: 150.17, y: 0 }, { x: 157.29, y: 83.54 }, { x: 95.36, y: 161.88 },
      { x: 115.54, y: 225.34 }, { x: 36.83, y: 225.45 }, { x: -15.84, y: 154.12 },
    ],
    pathOffset: { x: 0, y: 0 }, fill: 'rgba(255, 255, 255, 0)', stroke: 'rgba(255, 0, 0, 1)', strokeWidth: 2,
    strokeDashArray: [6, 4], strokeUniform: true, scaleX: 1, scaleY: 1, angle: 0, data: {},
  },
  textbox: {
    type: 'Textbox', originX: 'left', originY: 'top', left: 619.47, top: 142.67, width: 104.11, height: 36.48,
    fill: '#000000', stroke: '#000000', strokeWidth: 1, fontSize: 17.6, fontFamily: 'Helvetica',
    text: 'rfgrgrgrgrgr', scaleX: 1, scaleY: 1, angle: 0, data: {},
  },
  'counter pin': {
    type: 'circle', left: 505.75, top: 621.02, radius: 14, fill: '#ff0000', stroke: '#ffffff', strokeWidth: 1.5,
    strokeUniform: true, data: { type: 'counter', pointerAngle: 320, displayNumber: 2, numberColor: '#ffffff' },
  },
};

const PAGE = { pageWidth: 1224, pageHeight: 792 };

const hasVisibleStroke = (obj) => {
  const s = String(obj.stroke || '').replace(/\s/g, '').toLowerCase();
  return Number(obj.strokeWidth) > 0 && s && s !== 'transparent' && s !== 'none' && !/,0\)$/.test(s);
};

const visibleBox = (obj) => {
  const box = getAnnotationWorldAABB(obj);
  const pad = (hasVisibleStroke(obj) ? Number(obj.strokeWidth) / 2 : 0) + 1;
  return {
    left: box.left - pad,
    top: box.top - pad,
    right: box.left + box.width + pad,
    bottom: box.top + box.height + pad,
  };
};

const withSize = (r) => ({ ...r, width: r.right - r.left, height: r.bottom - r.top });

const hits = (obj, marqueeRect, direction) => resolveMarqueeHits({
  marqueeRect: withSize(marqueeRect),
  direction,
  annotations: { objects: [obj] },
  callouts: [],
  ...PAGE,
}).annotationIndices.length === 1;

for (const [kind, obj] of Object.entries(KINDS)) {
  test(`window and crossing marquees both catch a ${kind} boxed snugly where it draws`, () => {
    const box = visibleBox(obj);
    assert.ok(hits(obj, box, 'window'), `${kind}: left-to-right box around it missed it`);
    assert.ok(hits(obj, box, 'crossing'), `${kind}: right-to-left box around it missed it`);
  });

  test(`a window marquee that cuts a slice off a ${kind} does not catch it`, () => {
    const box = visibleBox(obj);
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    // Trim along the longer axis so thin marks (a flat line) still lose a slice.
    const trimmed = width >= height
      ? { ...box, right: box.right - Math.max(4, width * 0.25) }
      : { ...box, bottom: box.bottom - Math.max(4, height * 0.25) };
    assert.equal(hits(obj, trimmed, 'window'), false, `${kind}: window caught a mark it does not fully hold`);
  });
}

test('SE-011 regression: a left-to-right box over the whole page catches every mark, the purple stroke included', () => {
  const objects = Object.values(KINDS);
  const page = withSize({ left: 0, top: 0, right: PAGE.pageWidth, bottom: PAGE.pageHeight });
  const { annotationIndices } = resolveMarqueeHits({
    marqueeRect: page, direction: 'window', annotations: { objects }, callouts: [], ...PAGE,
  });
  assert.deepEqual(annotationIndices, objects.map((_, i) => i));
});
