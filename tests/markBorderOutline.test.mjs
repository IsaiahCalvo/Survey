// Owner Test 45 (2026-10-06): the hover halo and the selection grabbers follow
// the border actually drawn. A clouded text box and a clouded callout box are
// drawn as the house RECTANGLE cloud, so they take a clouded rectangle's glow
// and its eight grabbers on the outer hump edge; a callout box gets all eight
// rectangle grabbers (it had four corners), and an edge grabber resizes only
// its own edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calloutBoxCloudGeometry,
  calloutBoxHandleLayout,
  calloutVisibleBox,
  markBorderCloudChrome,
  markBorderCloudGeometry,
  resizeCalloutBox,
} from '../src/utils/markBorderOutline.js';
import { cloudHoverGlowWidth, cloudOutlineBounds, cloudSelectionChrome } from '../src/utils/cloudAnnotationGeometry.js';

const cloudTextbox = {
  type: 'textbox', text: 'Cloud box', left: 100, top: 200, width: 90, height: 30,
  stroke: '#000000', strokeWidth: 1, fill: '#000000', backgroundColor: '', angle: 0,
  data: { id: 't1', pdfCloudIntensity: 2 },
};
const cloudRect = {
  type: 'rect', left: 100, top: 200, width: 90, height: 30, stroke: '#000000', strokeWidth: 1,
  fill: 'transparent', angle: 0, data: { id: 'r1', pdfCloudIntensity: 2 },
};

test('a clouded text box glows and frames exactly like the same clouded rectangle', () => {
  const box = markBorderCloudGeometry(cloudTextbox);
  const rect = markBorderCloudGeometry(cloudRect);
  assert.ok(box && rect, 'both resolve a cloud');
  assert.deepEqual(cloudOutlineBounds(box), cloudOutlineBounds(rect));
  const chrome = markBorderCloudChrome(cloudTextbox);
  assert.deepEqual(chrome.anchors, cloudSelectionChrome(cloudRect).anchors);
  // Every grabber sits OUTSIDE the box, on the outer hump edge (not on the
  // inner box: the old corners sat on the line, the edge grabbers inside).
  for (const [id, pt] of Object.entries(chrome.anchors)) {
    const inside = pt.x > cloudTextbox.left && pt.x < cloudTextbox.left + 90
      && pt.y > cloudTextbox.top && pt.y < cloudTextbox.top + 30;
    assert.equal(inside, false, `${id} is outside the box`);
  }
});

test('a plain text box or a borderless one has no cloud chrome (it keeps the box chrome)', () => {
  assert.equal(markBorderCloudChrome({ ...cloudTextbox, data: { id: 't2' } }), null);
  assert.equal(markBorderCloudChrome({ ...cloudTextbox, strokeWidth: 0 }), null);
  assert.equal(markBorderCloudGeometry({ type: 'path', path: [] }), null);
});

test('a cloud shape still resolves its own chrome unchanged', () => {
  assert.deepEqual(markBorderCloudChrome(cloudRect), cloudSelectionChrome(cloudRect));
});

const page = { W: 612, H: 792 };
const callout = (lineStyle) => ({
  id: 'c1',
  textBoxPosition: { x: 300 / 612, y: 400 / 792 },
  textBoxWidth: 120 / 612,
  textBoxHeight: 32 / 792,
  style: { lineThickness: 2, fontSize: 14, lineStyle, cloudIntensity: 2 },
});

test('callout box: the visible box includes the descender buffer renderCallout adds', () => {
  const box = calloutVisibleBox(callout('solid'), page.W, page.H);
  assert.ok(Math.abs(box.x - 300) < 1e-6 && Math.abs(box.y - 400) < 1e-6);
  assert.ok(Math.abs(box.width - 120) < 1e-6);
  assert.ok(Math.abs(box.height - (32 + 14 * 0.35)) < 1e-6);
  assert.ok(Math.abs(box.borderWidth - 1.4) < 1e-9);
});

test('plain callout box: eight grabbers on its drawn border, no frame', () => {
  const box = calloutVisibleBox(callout('solid'), page.W, page.H);
  const layout = calloutBoxHandleLayout(callout('solid'), box);
  assert.equal(layout.frame, null);
  assert.deepEqual(Object.keys(layout.anchors).sort(), ['bl', 'br', 'mb', 'ml', 'mr', 'mt', 'tl', 'tr']);
  assert.deepEqual(layout.anchors.tl, { x: box.x, y: box.y });
  assert.deepEqual(layout.anchors.br, { x: box.x + box.width, y: box.y + box.height });
  assert.equal(layout.anchors.mr.y, box.y + box.height / 2);
});

test('clouded callout box: eight grabbers on the outer hump edge with the dashed frame', () => {
  const c = callout('cloud');
  const box = calloutVisibleBox(c, page.W, page.H);
  const layout = calloutBoxHandleLayout(c, box);
  assert.ok(layout.frame, 'a clouded box shows the frame');
  const geometry = calloutBoxCloudGeometry(c, box);
  const hull = cloudOutlineBounds(geometry);
  const ox = geometry.origin?.x || 0;
  const oy = geometry.origin?.y || 0;
  assert.ok(layout.frame.left < hull.left + ox && layout.frame.top < hull.top + oy, 'frame clears the humps');
  assert.ok(layout.frame.left + layout.frame.width > hull.left + ox + hull.width);
  assert.ok(layout.anchors.ml.x < box.x && layout.anchors.mr.x > box.x + box.width, 'edge grabbers outside the box');
  assert.ok(layout.anchors.mt.y < box.y && layout.anchors.mb.y > box.y + box.height);
  assert.equal(calloutBoxCloudGeometry(callout('solid'), box), null);
});

test('callout box resize: corners move two edges, edge grabbers one, the far side stays put', () => {
  const start = { position: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.1 };
  const r = (id, dx, dy) => resizeCalloutBox(start, id, dx, dy, 0.02, 0.02);
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  let out = r('mr', 0.1, 0.3);
  assert.ok(close(out.textBoxWidth, 0.3) && close(out.textBoxHeight, 0.1) && close(out.textBoxPosition.y, 0.5), 'mr ignores dy');
  out = r('mb', 0.3, 0.05);
  assert.ok(close(out.textBoxWidth, 0.2) && close(out.textBoxHeight, 0.15), 'mb ignores dx');
  out = r('ml', -0.1, 0);
  assert.ok(close(out.textBoxPosition.x, 0.4) && close(out.textBoxWidth, 0.3), 'ml keeps the right edge');
  out = r('mt', 0, -0.05);
  assert.ok(close(out.textBoxPosition.y, 0.45) && close(out.textBoxHeight, 0.15), 'mt keeps the bottom edge');
  out = r('tl', -0.1, -0.05);
  assert.ok(close(out.textBoxPosition.x, 0.4) && close(out.textBoxPosition.y, 0.45)
    && close(out.textBoxWidth, 0.3) && close(out.textBoxHeight, 0.15), 'tl moves both');
  out = r('br', 0.05, 0.05);
  assert.ok(close(out.textBoxWidth, 0.25) && close(out.textBoxHeight, 0.15), 'br as before');
  out = r('mr', -0.5, 0);
  assert.ok(close(out.textBoxPosition.x + out.textBoxWidth, 0.5), 'flips through the fixed left edge');
  out = r('mb', 0, -0.0999);
  assert.ok(close(out.textBoxHeight, 0.02), 'never under the minimum');
});

test('a thin cloud still gets a readable glow; 2 pt and up keep the Drawboard 2.85x', () => {
  assert.equal(cloudHoverGlowWidth(1), 4);
  assert.ok(Math.abs(cloudHoverGlowWidth(2) - 5.7) < 1e-9);
  assert.equal(cloudHoverGlowWidth(0), 0);
});

test('wiring: the layer hands clouded text boxes / callout boxes the shared geometry', () => {
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /markBorderCloudGeometry\(renderObj\)/, 'text box glow');
  assert.match(layer, /annotationIsHovered && !cloudGlowGeometry && \(/, 'no box rect under the cloud glow');
  assert.match(layer, /calloutBoxCloudGeometry\(callout, \{/, 'callout halo follows the humps');
  assert.match(layer, /calloutBoxHandleLayout\(callout, calloutVisibleBox\(callout, W, H\)\)/, 'callout grabbers');
  assert.match(layer, /handlePartAttributes=\{\(id\) => \(\{ 'data-callout-part': `textBox-\$\{id\}` \}\)\}/);
  const overlay = readFileSync(new URL('../src/components/SVGSelectionOverlay.jsx', import.meta.url), 'utf8');
  assert.match(overlay, /const pressHandler = \(id\) => \(delegateHandlePress \? undefined :/);
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /const resizePatch = resizeCalloutBox\(/);
});
