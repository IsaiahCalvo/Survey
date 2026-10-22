import test from 'node:test';
import assert from 'node:assert/strict';

import { polyVertexMenuLayout } from '../src/utils/polyVertices.js';
import { buildCanvasPageItems } from '../src/sidebar/pageMenuItems.js';

test('a long-press Delete point menu has a 44px row and stays on a 320px phone', () => {
  const m = polyVertexMenuLayout({ x: 298, y: 397, touch: true, viewportWidth: 320, viewportHeight: 568 });
  assert.equal(m.rowHeight, 44);
  assert.ok(m.left >= 8 && m.left + m.width <= 312, `left ${m.left} width ${m.width}`);
});

test('a corner near the bottom edge keeps the menu above it', () => {
  const m = polyVertexMenuLayout({ x: 100, y: 560, touch: true, viewportWidth: 375, viewportHeight: 667 });
  assert.ok(m.top + m.rowHeight + 10 <= 667 - 8);
  const low = polyVertexMenuLayout({ x: 100, y: 660, touch: true, viewportWidth: 375, viewportHeight: 667 });
  assert.ok(low.top + low.rowHeight + 10 <= 667 - 8);
});

test('a mouse right-click keeps the compact desktop row at the pointer', () => {
  const m = polyVertexMenuLayout({ x: 200, y: 150, viewportWidth: 1440, viewportHeight: 900 });
  assert.deepEqual(m, { left: 200, top: 150, width: 140, rowHeight: 36 });
});

test('the page menu labels stay short enough for a 320px phone menu', () => {
  const labels = buildCanvasPageItems({ canPasteInPlace: true }).filter((i) => i.label).map((i) => i.label);
  assert.ok(labels.includes('Select all on page'));
  for (const label of labels) assert.ok(label.length <= 18, label);
});

test('a long-press Add point here menu on a side keeps a 44px row on every phone size', async () => {
  const { readFileSync } = await import('node:fs');
  for (const [w, h] of [[320, 568], [375, 667], [390, 844]]) {
    const m = polyVertexMenuLayout({ x: w - 4, y: h - 4, touch: true, viewportWidth: w, viewportHeight: h });
    assert.equal(m.rowHeight, 44);
    assert.ok(m.left >= 8 && m.left + m.width <= w - 8);
    assert.ok(m.top >= 8 && m.top + m.rowHeight + 10 <= h - 8);
  }
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  // The side's touch long-press opens the edge menu, and its row uses the layout height.
  assert.match(src, /startPolyLongPress\(\{ clientX: x, clientY: y, pointerId, fromTouchStream: pointerId == null \}, \{ edge: \{ segmentIndex: hit\.segmentIndex, t: hit\.t \} \}\)/);
  assert.match(src, /data-poly-vertex-insert="true"[\s\S]{0,900}minHeight: menuLayout\.rowHeight/);
  // The page/mark long-press menu stays off a selected poly's side.
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /const onHandle = [^\n]*\[data-poly-edge-hit\]/);
});

test('a pen / touch side long-press band covers a cloud polygon\'s crowns, mouse keeps the plain band', async () => {
  const { cloudPolyEdgeReach } = await import('../src/utils/polyVertices.js');
  const pts = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }];
  // Crowns reach 18 units above the top side (frame from cloudSelectionChrome).
  assert.equal(cloudPolyEdgeReach(pts, { left: 92, top: 82, width: 216, height: 126 }), 18);
  // Frame inside the corners (or none): no extra reach.
  assert.equal(cloudPolyEdgeReach(pts, { left: 100, top: 100, width: 200, height: 100 }), 0);
  assert.equal(cloudPolyEdgeReach(pts, null), 0);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  // Reach only on a coarse pointer; band width and the long-press hit test share one tolerance.
  assert.match(src, /const polyEdgeReach = polyCloudChrome && isCoarsePointer/);
  assert.match(src, /insertVertexOnNearestEdge\(worldPoints, pt, polyEdgeTolerance,/);
  assert.match(src, /data-poly-edge-hit="true"[\s\S]{0,700}strokeWidth=\{polyEdgeTolerance \* 2\}/);
});

test('a pen / touch press hit-tested onto the selected poly itself still arms the side long-press', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  // The layer root's capture listener lets the side band claim the press first.
  assert.match(src, /onPointerDownCapture=\{\(e\) => \{[\s\S]{0,400}querySelector\?\.\('\[data-poly-edge-hit\]'\)\?\.__claimPolyEdgePress\?\.\(e\)/);
  assert.match(src, /data-poly-edge-hit="true"\s*\n\s*ref=\{\(el\) => \{ if \(el\) \{ el\.__claimPolyEdgePress = claimPolyEdgePress\(el\); el\.__polyEdgeCtx = polyEdgeCtx;/);
  // Pen / touch only (mouse unchanged), only on the selected mark or bare layer, only within the side tolerance.
  const claim = src.slice(src.indexOf('const claimPolyEdgePress'), src.indexOf('const vertexFocused'));
  assert.match(claim, /e\.pointerType !== 'pen' && e\.pointerType !== 'touch'/);
  assert.match(claim, /data-annotation-index="\$\{selectedIndex\}"/);
  assert.match(claim, /handleAnnotationPointerDown\(e, selectedIndex\)/);
});

test('the window-level side claim finds the side by screen position alone', async () => {
  const { polyEdgeHitAtClient, polyEdgeDebugEnabled } = await import('../src/utils/polyVertices.js');
  // A selected 3-corner polygon (after a Delete point); band CTM: 0.5 px per unit, page at (50, 205).
  const pts = [{ x: 100, y: 600 }, { x: 460, y: 600 }, { x: 460, y: 720 }];
  const ctm = { a: 0.5, b: 0, c: 0, d: 0.5, e: 50, f: 205 };
  const screen = (p) => [ctm.a * p.x + ctm.e, ctm.d * p.y + ctm.f];
  const [sx, sy] = screen({ x: 100 + 0.3 * 360, y: 600 });
  const hit = polyEdgeHitAtClient(sx, sy + 6, ctm, pts, 30, { closed: true });
  assert.equal(hit.segmentIndex, 0);
  assert.ok(Math.abs(hit.t - 0.3) < 1e-9);
  // Outside the band tolerance: no claim.
  assert.equal(polyEdgeHitAtClient(sx, sy + 40, ctm, pts, 30, { closed: true }), null);
  // Rotated / scaled band: still mapped back through the inverse CTM.
  const rot = { a: 0, b: 1, c: -1, d: 0, e: 300, f: 100 };
  const p = { x: 100 + 0.5 * 360, y: 600 };
  const hit2 = polyEdgeHitAtClient(rot.a * p.x + rot.c * p.y + rot.e, rot.b * p.x + rot.d * p.y + rot.f, rot, pts, 5);
  assert.equal(hit2.segmentIndex, 0);
  assert.ok(Math.abs(hit2.t - 0.5) < 1e-9);
  assert.equal(polyEdgeHitAtClient(0, 0, null, pts, 5), null);
  // Debug switch: localStorage or ?debugPolyEdge=1, off otherwise.
  assert.equal(polyEdgeDebugEnabled({ localStorage: { getItem: () => '1' }, location: { search: '' } }), true);
  assert.equal(polyEdgeDebugEnabled({ localStorage: { getItem: () => null }, location: { search: '?debugPolyEdge=1' } }), true);
  assert.equal(polyEdgeDebugEnabled({ localStorage: { getItem: () => { throw new Error('blocked'); } }, location: { search: '' } }), false);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(src, /window\.addEventListener\('pointerdown', onPointerDown, opts\)/);
  assert.match(src, /window\.addEventListener\('touchstart', onTouchStart, opts\)/);
  assert.match(src, /const onCancel = \(\) => \{ if \(!touchDown\) \{ gate\.end\(\); cleanup\(.pointercancel.\); \} \}/);
});

test('one press, one arm, one insert', async () => {
  const { createPolyEdgePressGate } = await import('../src/utils/polyVertices.js');
  const g = createPolyEdgePressGate();
  // adb stylus hold: window pointerdown claim, then touchstart fallback, then the layer claim - same contact.
  const token = g.arm(158, 543, 0);
  assert.ok(token);
  assert.equal(g.arm(158, 543, 2), null);
  assert.equal(g.arm(161, 545, 5), null);
  // The timer fires once, for its own token only.
  assert.equal(g.fire({}), false);
  assert.equal(g.fire(token), true);
  assert.equal(g.fire(token), false);
  // The pen lifting onto the menu it opened is not a choice.
  assert.equal(g.pressLive(600), true);
  g.end();
  assert.equal(g.pressLive(1500), false);
  // One menu, one insert, however many clicks reach it.
  const menu = { annotationIndex: 0, edge: { segmentIndex: 0, t: 0.3 } };
  let inserts = 0;
  for (let i = 0; i < 5; i += 1) if (!g.pressLive() && g.consume(menu)) inserts += 1;
  assert.equal(inserts, 1);
  // A new press after the lift arms again.
  assert.ok(g.arm(158, 543, 3000));
  // An unseen lift expires.
  assert.equal(g.pressLive(9000), false);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(src, /const token = gate\.arm\(e\.clientX, e\.clientY\);\s*\n[^\n]*\n\s*if \(!token\)/);
  assert.match(src, /if \(!gate\.fire\(token\)\) return;/);
  assert.match(src, /data-poly-vertex-insert="true"[\s\S]{0,500}if \(gate\.pressLive\(\) \|\| !gate\.consume\(polyVertexMenu\)\) return;/);
});

test('a touchstart never overrules the pen pointerdown claim, and a claimed press keeps the selection', async () => {
  const { polyEdgeTouchStartMayArm, POLY_EDGE_TOUCH_FALLBACK_MS } = await import('../src/utils/polyVertices.js');
  // No pointer event for this contact: the touchstart fallback arms.
  assert.equal(polyEdgeTouchStartMayArm(NaN, 1000), true);
  // A pen pointerdown just decided (refused): the stylus touchstart must not arm.
  assert.equal(polyEdgeTouchStartMayArm(1000, 1003), false);
  assert.equal(polyEdgeTouchStartMayArm(1000, 1000 + POLY_EDGE_TOUCH_FALLBACK_MS + 1), true);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(src, /polyEdgeTouchStartMayArm\(lastPointerDownAt, performance\.now\(\)\)/);
  assert.match(src, /if \(claimed && !ctx\.ownsTarget\(e\.target\)\) e\.stopPropagation\(\);/);
  assert.match(src, /if \(polyVertexMenu\.annotationIndex !== selectedPolyIndex\) \{ setPolyVertexMenu\(null\); return; \}/);
  const walk = readFileSync(new URL('../.github/native-flows/android-delete-point.sh', import.meta.url), 'utf8');
  assert.match(walk, /set -- \$xy; set -- "\$1" "\$\(\(\$2 \+ TOP\)\)"/);
});
