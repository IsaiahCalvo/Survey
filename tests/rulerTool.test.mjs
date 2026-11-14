import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULER_WIDTH, getRulerPlace, isRulerOn, projectOntoEdge, readoutAngle, rulerEdgeNear, rulerEdges,
  setRulerOn, setRulerPlace, settleAngle, startingPlace, toggleRuler,
} from '../src/utils/ruler.js';

const level = { cx: 500, cy: 300, angle: 0, length: 400 };

test('the long edges sit half the width above and below the middle', () => {
  const [top, bottom] = rulerEdges(level);
  assert.deepEqual([top.a.y, bottom.a.y], [300 - RULER_WIDTH / 2, 300 + RULER_WIDTH / 2]);
  assert.deepEqual([top.a.x, top.b.x], [300, 700]);
  assert.equal(top.normal.y, -1);
  assert.equal(bottom.normal.y, 1);
});

test('a stroke started just outside an edge locks to it; far away or past the ends it does not', () => {
  const bottom = rulerEdgeNear(level, 450, 300 + RULER_WIDTH / 2 + 10);
  assert.equal(bottom.normal.y, 1);
  const top = rulerEdgeNear(level, 450, 300 - RULER_WIDTH / 2 - 5);
  assert.equal(top.normal.y, -1);
  assert.equal(rulerEdgeNear(level, 450, 300 + RULER_WIDTH / 2 + 60), null);
  assert.equal(rulerEdgeNear(level, 100, 300 + RULER_WIDTH / 2 + 5), null);
  // the middle of the ruler itself is not an edge
  assert.equal(rulerEdgeNear(level, 450, 300), null);
});

test('points move straight onto the edge, also when the ruler is turned', () => {
  const edge = rulerEdgeNear(level, 450, 345);
  assert.deepEqual(projectOntoEdge(edge, 610, 351), { x: 610, y: 300 + RULER_WIDTH / 2 });
  const turned = { ...level, angle: 45 };
  const [a] = rulerEdges(turned);
  const p = projectOntoEdge(a, a.a.x + 50, a.a.y + 10);
  const along = (p.x - a.a.x) * a.normal.x + (p.y - a.a.y) * a.normal.y;
  assert.ok(Math.abs(along) < 1e-9, 'the projected point lies on the edge line');
});

test('the angle settles on 15° steps when close and reads like a protractor', () => {
  assert.equal(settleAngle(44), 45);
  assert.equal(settleAngle(37), 37);
  assert.equal(settleAngle(-1.5), 0);
  assert.equal(settleAngle(359), 0);
  assert.equal(settleAngle(181), 180);
  assert.equal(readoutAngle(-30), 150);
  assert.equal(readoutAngle(180), 0);
  assert.equal(readoutAngle(90), 90);
});

test('on / off is shared, and the drawing layer sees no ruler while it is off', () => {
  setRulerOn(false);
  setRulerPlace(startingPlace({ left: 0, top: 0, width: 1000, height: 800 }));
  assert.equal(getRulerPlace(), null);
  toggleRuler();
  assert.equal(isRulerOn(), true);
  assert.deepEqual(getRulerPlace(), { cx: 500, cy: 400, angle: 0, length: 700 });
  toggleRuler();
  assert.equal(getRulerPlace(), null);
});

test('the ruler is wired into the Draw group, the phone rail and the pen (source)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  assert.match(src('PDFViewer.jsx'), /rulerToolEnabled \? \[\{ id: 'ruler', label: 'Ruler', iconName: 'ruler', toggle: true \}\]/);
  assert.match(src('mobile/MobilePdfViewerChrome.jsx'), /id: 'ruler', label: 'Ruler', icon: 'ruler', flag: 'ruler-tool', toggle: true/);
  const layer = src('components/SVGAnnotationLayer.jsx');
  assert.match(layer, /rulerEdgeNear\(ruler, nativeEvent\.clientX, nativeEvent\.clientY\)/);
  assert.match(layer, /projectOntoEdge\(rulerEdge, sample\.clientX, sample\.clientY\)/);
});
