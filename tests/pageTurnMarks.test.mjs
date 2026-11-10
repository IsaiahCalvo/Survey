import test from 'node:test';
import assert from 'node:assert/strict';
import { turnPageMarks, turnPageObject, turnMarkerBounds, quarterTurnPoint } from '../src/utils/pageTurnMarks.js';
import { transformPageState } from '../src/utils/pageAnnotationReindex.js';
import { inversePageOperation } from '../src/utils/pageOperationHistory.js';
import { lineWorldPoints } from '../src/utils/groupResize.js';

const W = 792;
const H = 612;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('a quarter turn maps the page frame onto the sideways one', () => {
  const cw = quarterTurnPoint(90, { width: W, height: H });
  assert.deepEqual(cw({ x: 0, y: 0 }), { x: H, y: 0 });
  assert.deepEqual(cw({ x: W, y: H }), { x: 0, y: W });
  const ccw = quarterTurnPoint(-90, { width: W, height: H });
  assert.deepEqual(ccw({ x: 0, y: 0 }), { x: 0, y: W });
});

test('a box turns about its centre and takes the quarter', () => {
  const rect = { type: 'rect', left: 40, top: 60, width: 100, height: 50, angle: 0, strokeWidth: 0 };
  const turned = turnPageObject(rect, 90, { width: W, height: H });
  close(turned.angle, 90, 'angle');
  // centre (90, 85) -> (H - 85, 90)
  close(turned.left + 50, H - 85, 'centre x');
  close(turned.top + 25, 90, 'centre y');
});

test('text stays readable: it moves but does not tip over', () => {
  const text = { type: 'textbox', left: 10, top: 10, width: 80, height: 20, angle: 0, text: 'hi' };
  const turned = turnPageObject(text, 90, { width: W, height: H });
  assert.equal(turned.angle, 0);
  assert.notEqual(turned.left, 10);
});

test('a line turns its drawn ends', () => {
  const line = { type: 'line', left: 100, top: 100, width: 100, height: 0, x1: -50, y1: 0, x2: 50, y2: 0, angle: 0 };
  const turned = turnPageObject(line, 90, { width: W, height: H });
  const { p1, p2 } = lineWorldPoints(turned);
  close(p1.x, H - 100, 'p1 x'); close(p1.y, 100, 'p1 y');
  close(p2.x, H - 100, 'p2 x'); close(p2.y, 200, 'p2 y');
});

test('a counter keeps its number upright and swings its pointer', () => {
  const counter = { type: 'group', left: 0, top: 0, radius: 10, data: { type: 'counter', pointerAngle: 225 } };
  const turned = turnPageObject(counter, 90, { width: W, height: H });
  assert.equal(turned.data.pointerAngle, 315);
  close(turned.left + 10, H - 10, 'centre x');
});

test('marker bounds turn about their centre', () => {
  const b = turnMarkerBounds({ x: 0, y: 0, width: 20, height: 10 }, -90, { width: W, height: H });
  close(b.x + 10, 5, 'centre x');
  close(b.y + 5, W - 10, 'centre y');
  assert.equal(b.angle, -90);
});

test('four turns bring every mark home; marks on other pages stay put', () => {
  const state = {
    annotationsByPage: {
      1: { objects: [{ type: 'rect', left: 40, top: 60, width: 100, height: 50, angle: 0, strokeWidth: 0 }] },
      2: { objects: [{ type: 'rect', left: 5, top: 5, width: 10, height: 10, angle: 0, strokeWidth: 0 }] },
    },
    surveyMarkers: { m1: { pageNumber: 1, bounds: { x: 10, y: 20, width: 30, height: 40 } } },
    spaces: [{ id: 's', assignedPages: [{ pageId: 1, regions: [{ shapeType: 'rectangular', coordinates: [10, 10, 50, 10, 50, 30, 10, 30] }] }] }],
  };
  let s = state;
  let size = { width: W, height: H };
  for (let i = 0; i < 4; i += 1) {
    s = turnPageMarks(s, 1, 90, size);
    size = { width: size.height, height: size.width };
  }
  const r = s.annotationsByPage[1].objects[0];
  close(r.left, 40, 'left'); close(r.top, 60, 'top'); close(r.angle, 0, 'angle');
  assert.deepEqual(s.annotationsByPage[2], state.annotationsByPage[2]);
  const m = s.surveyMarkers.m1.bounds;
  close(m.x, 10, 'marker x'); close(m.y, 20, 'marker y');
  s.spaces[0].assignedPages[0].regions[0].coordinates.forEach((v, i) => close(v, state.spaces[0].assignedPages[0].regions[0].coordinates[i], `region ${i}`));
});

test('the page step turns marks and its Undo turns them back', () => {
  const state = {
    annotationsByPage: { 1: { objects: [{ type: 'rect', left: 40, top: 60, width: 100, height: 50, angle: 0, strokeWidth: 0 }] } },
    surveyMarkers: {}, annotations: {}, pageNames: {}, pageTransformations: {}, bookmarks: [], spaces: [],
  };
  const op = { type: 'rotate', page: 1, delta: 90, pageSize: { width: W, height: H } };
  const turned = transformPageState(state, op);
  close(turned.annotationsByPage[1].objects[0].angle, 90, 'turned');
  const { stateOperation } = inversePageOperation(op, { stateBefore: state, pageTransformBefore: null });
  assert.deepEqual(stateOperation.pageSize, { width: H, height: W });
  const back = transformPageState(turned, stateOperation);
  const r = back.annotationsByPage[1].objects[0];
  close(r.left, 40, 'left'); close(r.top, 60, 'top'); close(r.angle, 0, 'angle');
});

test('without a page size the step leaves marks alone (older recorded steps)', () => {
  const state = { annotationsByPage: { 1: { objects: [{ type: 'rect', left: 1, top: 2, width: 3, height: 4 }] } } };
  const next = transformPageState(state, { type: 'rotate', page: 1, delta: 90 });
  assert.equal(next.annotationsByPage[1].objects[0].left, 1);
});

test('a callout turns its leader and keeps its card upright', async () => {
  const { calloutToAnnotationObject, annotationObjectToCallout } = await import('../src/utils/calloutAnnotationBridge.js');
  const callout = {
    id: 'c1', pageNumber: 1, text: 'note',
    arrowTip: { x: 0.1, y: 0.2 }, knee: { x: 0.2, y: 0.2 },
    textBoxPosition: { x: 0.3, y: 0.15 }, textBoxWidth: 0.2, textBoxHeight: 0.1,
    style: {},
  };
  const obj = calloutToAnnotationObject(callout, { width: W, height: H });
  const turned = turnPageObject(obj, 90, { width: W, height: H });
  const read = annotationObjectToCallout(turned, { width: H, height: W });
  // tip (0.1W, 0.2H) -> (H - 0.2H, 0.1W) in the H x W frame
  close(read.arrowTip.x * H, H - 0.2 * H, 'tip x');
  close(read.arrowTip.y * W, 0.1 * W, 'tip y');
  // The card keeps its size on the page.
  close(read.textBoxWidth * H, 0.2 * W, 'card width');
  close(read.textBoxHeight * W, 0.1 * H, 'card height');
  assert.equal(read.text, 'note');
});
