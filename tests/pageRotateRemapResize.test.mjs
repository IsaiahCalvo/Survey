import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPageSize,
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';
import { displayedBoxOrigin, displayedAngle, placeRotationHandle, clampHandleToPage, getHandlePositions, separateRotationHandle, getAnnotationBBox } from '../src/utils/svgBoundingBox.js';

// Source contracts for selected bbox resize / mtr on a remapped page
// after CW rotate (viewBox 0 0 792 612, angle 90). Distinct from
// E-01/E-02 on an unrotated page and from page-rotate-transformed
// (stops at remapped placement). Live proof:
// debug/scenarios/e2e-page-rotate-remap-resize.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function projectPointerToLocal(ptrDxWorld, ptrDyWorld, angleDeg) {
  const rad = (Number(angleDeg) || 0) * Math.PI / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  return {
    x: ptrDxWorld * cosA + ptrDyWorld * sinA,
    y: -ptrDxWorld * sinA + ptrDyWorld * cosA,
  };
}

function remappedRect() {
  const resized = {
    type: 'rect',
    left: 122.4,
    top: 205.9,
    width: 135.4,
    height: 152.2,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id: 'xf-rect', type: 'rect', tool: 'rect', pageNumber: 1 },
  };
  return transformPageState({
    annotationsByPage: { 1: { width: 612, height: 792, objects: [resized] } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });
}

test('remapper hands resize a 90deg object on a swapped 792x612 page', () => {
  const cw = remappedRect();
  const after = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(122.4 + 135.4 / 2, 205.9 + 152.2 / 2, 612, 792, 90);
  assert.equal(after.angle, 90);
  assert.equal(after.width, 135.4);
  assert.equal(after.height, 152.2);
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);
  assert.deepEqual(rotateDisplayedPageSize(612, 792, 90), { width: 792, height: 612 });
  assert.ok(Math.abs((after.left + 135.4 / 2) - expected.x) < 1e-6);
  assert.ok(Math.abs((after.top + 152.2 / 2) - expected.y) < 1e-6);
  const cx = after.left + 135.4 / 2;
  const cy = after.top + 152.2 / 2;
  assert.ok(cx > 0 && cx < 792);
  assert.ok(cy > 0 && cy < 612);
  assert.equal(after.data.left, after.left);
  assert.equal(after.data.top, after.top);
  assert.equal(after.data.angle, 90);
});

test('displayedBoxOrigin prefers remapped data.left when Fabric left is 0', () => {
  assert.deepEqual(displayedBoxOrigin({ left: 0, top: 0, data: { left: 648.17, top: -8.4 } }), {
    left: 648.17,
    top: -8.4,
  });
  assert.deepEqual(displayedBoxOrigin({ left: 122.4, top: 205.9, data: { left: 122.4, top: 205.9 } }), {
    left: 122.4,
    top: 205.9,
  });
  assert.deepEqual(displayedBoxOrigin({ left: 0, top: 0, data: {} }), { left: 0, top: 0 });
});

test('displayedBoxOrigin prefers remapped data when Fabric origin is a 180deg flip', () => {
  // Live remapped-page mtr 90→180 rewrote Fabric left/top around (0,0):
  // 648.17 / −8.41 → −648.17 / 8.41. Overlay rotate(180, −580, 85) then
  // parked the stem at screen x≈−516. Keep the remapped origin.
  assert.deepEqual(displayedBoxOrigin({
    left: -648.17,
    top: 8.41,
    data: { left: 648.17, top: -8.41 },
  }), {
    left: 648.17,
    top: -8.41,
  });
});

test('displayedAngle prefers remapped data.angle when Fabric angle is 0', () => {
  assert.equal(displayedAngle({ angle: 0, data: { angle: 90 } }), 90);
  assert.equal(displayedAngle({ angle: 90, data: { angle: 90 } }), 90);
  assert.equal(displayedAngle({ angle: 0, data: {} }), 0);
});

function worldOf(local, bbox) {
  const cx = bbox.left + bbox.width / 2;
  const cy = bbox.top + bbox.height / 2;
  const rad = (bbox.angle * Math.PI) / 180;
  const dx = local.x - cx;
  const dy = local.y - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

test('placeRotationHandle shortens the 90deg stem so mtr stays on the 792 page', () => {
  const bbox = { left: 648.17, top: -8.41, width: 135.42, height: 152.24, angle: 90 };
  const cx = bbox.left + bbox.width / 2;
  const cy = bbox.top + bbox.height / 2;
  const unclamped = placeRotationHandle(bbox, { padding: 2, rotationOffset: 36 });
  const rad = 90 * Math.PI / 180;
  const worldUnclamped = {
    x: cx + (unclamped.x - cx) * Math.cos(rad) - (unclamped.y - cy) * Math.sin(rad),
    y: cy + (unclamped.x - cx) * Math.sin(rad) + (unclamped.y - cy) * Math.cos(rad),
  };
  assert.ok(worldUnclamped.x > 792, 'default 90deg stem must overshoot the remapped right edge');

  const placed = placeRotationHandle(bbox, {
    padding: 2,
    rotationOffset: 36,
    pageWidth: 792,
    pageHeight: 612,
    inset: 16,
  });
  const world = {
    x: cx + (placed.x - cx) * Math.cos(rad) - (placed.y - cy) * Math.sin(rad),
    y: cy + (placed.x - cx) * Math.sin(rad) + (placed.y - cy) * Math.cos(rad),
  };
  assert.ok(world.x <= 792 - 16 + 1e-6, 'clamped mtr must stay inside viewBox');
  assert.ok(world.x > cx + 4, 'clamped mtr must stay on the +x (90deg) ray');
  assert.ok(Math.abs(world.y - cy) < 1, 'clamped mtr must not leave the 90deg ray');
});

test('clampHandleToPage pulls remapped 90deg mt/tl/tr/ml/bl onto the 792 page', () => {
  const bbox = { left: 648.17, top: -8.41, width: 135.42, height: 152.24, angle: 90 };
  const raw = getHandlePositions(bbox, 2);
  const page = { pageWidth: 792, pageHeight: 612, inset: 16 };
  const offPage = ['mt', 'tl', 'tr', 'ml', 'bl'];
  const onPage = ['br', 'mb', 'mr'];
  for (const id of offPage) {
    const unclamped = worldOf(raw[id], bbox);
    assert.ok(
      unclamped.x > 792 || unclamped.y < 0,
      `${id} default world must sit past viewBox (got ${unclamped.x.toFixed(2)},${unclamped.y.toFixed(2)})`,
    );
    const clamped = clampHandleToPage(raw[id], bbox, page);
    const world = worldOf(clamped, bbox);
    assert.ok(world.x >= 16 - 1e-6 && world.x <= 792 - 16 + 1e-6, `${id} clamped x on-page`);
    assert.ok(world.y >= 16 - 1e-6 && world.y <= 612 - 16 + 1e-6, `${id} clamped y on-page`);
  }
  for (const id of onPage) {
    const unclamped = worldOf(raw[id], bbox);
    assert.ok(unclamped.x >= 0 && unclamped.x <= 792 && unclamped.y >= 0 && unclamped.y <= 612, `${id} already on-page`);
    const clamped = clampHandleToPage(raw[id], bbox, page);
    assert.ok(Math.abs(clamped.x - raw[id].x) < 1e-6, `${id} must not move when already on-page`);
    assert.ok(Math.abs(clamped.y - raw[id].y) < 1e-6, `${id} must not move when already on-page`);
  }
});

test('placeRotationHandle at 180deg keeps world mtr on the 612 page without flipping', () => {
  // After first remapped mtr 90→180 the stem is local-above (y < 0) while
  // overlay rotate(180) maps that to world-below. World is already on the
  // 612 page — Playwright boundingBox can still report x≈−516. Do not flip
  // to the opposite side (that jumps rotate math by 180).
  const bbox = { left: 648.17, top: -8.41, width: 135.42, height: 152.24, angle: 180 };
  const cx = bbox.left + bbox.width / 2;
  const cy = bbox.top + bbox.height / 2;
  const unclamped = placeRotationHandle(bbox, { padding: 2, rotationOffset: 36 });
  const worldUnclamped = worldOf(unclamped, bbox);
  assert.ok(unclamped.y < 0, 'default 180deg stem must sit local-above the viewBox');
  assert.ok(worldUnclamped.y > 16 && worldUnclamped.y < 612 - 16, '180deg world stem is already on the 612 page');
  assert.ok(worldUnclamped.y > cy + 4, '180deg world stem must sit on the +y (180deg) ray');
  assert.ok(Math.abs(worldUnclamped.x - cx) < 1);

  const placed = placeRotationHandle(bbox, {
    padding: 2,
    rotationOffset: 36,
    pageWidth: 792,
    pageHeight: 612,
    inset: 16,
  });
  const world = worldOf(placed, bbox);
  assert.ok(world.x >= 16 - 1e-6 && world.x <= 792 - 16 + 1e-6, 'clamped 180deg mtr x on-page');
  assert.ok(world.y >= 16 - 1e-6 && world.y <= 612 - 16 + 1e-6, 'clamped 180deg mtr y on-page');
  assert.ok(world.y > cy + 4, 'clamped 180deg mtr must stay on the +y ray — no flip');
  assert.ok(Math.abs(world.x - cx) < 1, 'clamped 180deg mtr must not leave the 180deg ray');

  const flipped = getAnnotationBBox({
    type: 'rect',
    left: -648.17,
    top: 8.41,
    width: 135.42,
    height: 152.24,
    scaleX: 1,
    scaleY: 1,
    angle: 180,
    data: { left: 648.17, top: -8.41, angle: 180 },
  });
  assert.ok(Math.abs(flipped.left - 648.17) < 1e-6, 'bbox origin must use remapped data, not the 180deg Fabric flip');
  assert.ok(Math.abs(flipped.top - (-8.41)) < 1e-6);
  const flippedPlaced = placeRotationHandle(flipped, {
    padding: 2,
    rotationOffset: 36,
    pageWidth: 792,
    pageHeight: 612,
    inset: 16,
  });
  const flippedWorld = worldOf(flippedPlaced, flipped);
  assert.ok(flippedWorld.x >= 16 && flippedWorld.x <= 776, 'flipped-origin 180deg mtr x on-page');
  assert.ok(flippedWorld.y >= 16 && flippedWorld.y <= 596, 'flipped-origin 180deg mtr y on-page');
  assert.ok(flippedWorld.y > (flipped.top + flipped.height / 2) + 4, 'flipped-origin stem stays on the +y ray');
});

test('separateRotationHandle keeps remapped mtr off the mt pill', () => {
  const bbox = { left: 648.17, top: -8.41, width: 135.42, height: 152.24, angle: 90 };
  const raw = getHandlePositions(bbox, 2);
  const page = { pageWidth: 792, pageHeight: 612, inset: 16 };
  const mt = clampHandleToPage(raw.mt, bbox, { ...page, inset: 8 });
  const mtr = placeRotationHandle(bbox, { padding: 2, rotationOffset: 36, ...page });
  const stacked = Math.hypot(mtr.x - mt.x, mtr.y - mt.y);
  assert.ok(stacked < 28, 'clamped mtr must sit on top of mt before separate');
  const separated = separateRotationHandle(mt, mtr, bbox, { minSep: 28, ...page });
  const dist = Math.hypot(separated.x - mt.x, separated.y - mt.y);
  assert.ok(dist >= 28 - 1e-6, 'separated mtr must clear the mt pill');
  const world = worldOf(separated, bbox);
  assert.ok(world.x >= 16 - 1e-6 && world.x <= 792 - 16 + 1e-6, 'separated mtr stays on-page');
});

test('line remapper does not invent endpoint remap (callout fractions are a sibling)', () => {
  const line = {
    type: 'line',
    left: 122.4,
    top: 205.9,
    width: 122.4,
    height: 142.6,
    x1: -61.2,
    y1: -71.3,
    x2: 61.2,
    y2: 71.3,
    angle: 0,
    data: { id: 'xf-line', type: 'line', tool: 'line', pageNumber: 1 },
  };
  const cw = transformPageState({
    annotationsByPage: { 1: { width: 612, height: 792, objects: [line] } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });
  const after = cw.annotationsByPage[1].objects[0];
  assert.equal(after.angle, 90);
  assert.equal(after.x1, -61.2);
  assert.equal(after.y1, -71.3);
  const cx = after.left + after.width / 2;
  const cy = after.top + after.height / 2;
  const p1 = worldOf({ x: cx + after.x1, y: cy + after.y1 }, { ...after, width: after.width, height: after.height, angle: 90 });
  const p2 = worldOf({ x: cx + after.x2, y: cy + after.y2 }, { ...after, width: after.width, height: after.height, angle: 90 });
  assert.ok(p1.x >= 0 && p1.x <= 792 && p1.y >= 0 && p1.y <= 612, 'typical remapped line p1 stays on-page');
  assert.ok(p2.x >= 0 && p2.x <= 792 && p2.y >= 0 && p2.y <= 612, 'typical mid-page line p2 stays on-page');
});

test('90deg local projection: screen +y grows local width; screen -x grows local height', () => {
  // Matches useSVGInteraction resize: un-rotate pointer around the world
  // anchor by -angle before signed scale. After remapper angle=90:
  // local +x → screen +y, local +y → screen -x.
  const growWidth = projectPointerToLocal(0, 40, 90);
  assert.ok(Math.abs(growWidth.x - 40) < 1e-9);
  assert.ok(Math.abs(growWidth.y) < 1e-9);
  const growHeight = projectPointerToLocal(-40, 0, 90);
  assert.ok(Math.abs(growHeight.x) < 1e-9);
  assert.ok(Math.abs(growHeight.y - 40) < 1e-9);
  const worldAxis = projectPointerToLocal(40, 0, 90);
  assert.ok(Math.abs(worldAxis.y + 40) < 1e-9, 'world +x must not be treated as local width at 90deg');
});

test('overlay rotate + local-frame resize + page-mutation undo wipe; no file.id stamp', () => {
  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  const interaction = read('src/hooks/useSVGInteraction.js');
  const viewer = read('src/PDFViewer.jsx');
  const reindex = read('src/utils/pageAnnotationReindex.js');
  const bbox = read('src/utils/svgBoundingBox.js');
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(overlay, /transform=\{angle \? `rotate\(\$\{angle\}, \$\{cx\}, \$\{cy\}\)` : undefined\}/);
  assert.match(overlay, /data-resize-handle=\{id\}/);
  assert.match(overlay, /data-rotation-handle/);
  assert.match(overlay, /placeRotationHandle/);
  assert.match(overlay, /clampHandleToPage/);
  assert.match(overlay, /separateRotationHandle/);
  assert.match(overlay, /pageWidth/);
  assert.match(bbox, /export function placeRotationHandle/);
  assert.match(bbox, /export function clampHandleToPage/);
  assert.match(bbox, /export function separateRotationHandle/);
  assert.match(bbox, /export function displayedAngle/);
  assert.match(interaction, /displayedAngle\(obj\)/);
  assert.match(interaction, /data = \{ \.\.\.rotObj\.data, angle: ds\.currentAngle \}/);
  assert.match(interaction, /svgRef\.current \|\| e\.target\)\.setPointerCapture/);
  assert.match(layer, /pageWidth=\{width\}/);
  assert.match(interaction, /rotation-aware resize/);
  assert.match(interaction, /Un-rotate the pointer around the shape's original center/);
  assert.match(interaction, /ptrDxLocal = ptrDxWorld \* cosA \+ ptrDyWorld \* sinA/);
  assert.match(interaction, /if \(Math\.abs\(newScaleX\) < 0\.01\) newScaleX/);
  assert.match(interaction, /typeForFlip === 'rect'/);
  assert.match(viewer, /setUndoHistory\(\[\]\);\s*\n\s*setRedoHistory\(\[\]\);\s*\n\s*undoHistoryRef\.current = \[\];[\s\S]*Page mutations remap annotation addresses/);
  assert.match(reindex, /rotateDisplayedPoint/);
  assert.match(reindex, /data\.left = next\.left/);
  assert.match(reindex, /next\.left = nextLeft/);
  assert.match(bbox, /export function displayedBoxOrigin/);
  assert.match(layer, /displayedBoxOrigin\(renderObj\)/);
  assert.match(viewer, /pageMutationRevision/);
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers remapped-page br\/mtr, remapped mt, collapse, flip, undo-last-resize, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-resize.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /remapper must swap viewBox/);
  assert.match(spec, /post-rotate br must grow size in swapped viewBox/);
  assert.match(spec, /mtr on the remapped page updates angle/);
  assert.match(spec, /post-rotate mtr must update angle/);
  assert.match(spec, /desktop remapped-page mtr at object 180 after CW/);
  assert.match(spec, /mtr knob must stay inside the remapped page/);
  assert.match(spec, /180deg mtr must stay hittable/);
  assert.match(spec, /getScreenCTM/);
  assert.match(spec, /post-rotate mt must grow size in swapped viewBox/);
  assert.match(spec, /mt knob must stay inside the remapped page/);
  assert.doesNotMatch(spec, /MTR_OPTIONAL_SKIP/);
  assert.match(spec, /undo must restore post-rotate size, not the page rotate/);
  assert.match(spec, /undo must not invert page rotate/);
  assert.match(spec, /collapse must keep a visible width/);
  assert.match(spec, /COLLAPSE_FLIP_NOT_APPLICABLE|flip past opposite/);
  assert.match(spec, /br must sit near remapped hit, not pre-rotate origin/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /390 remapped-resize edge/);
  assert.match(spec, /390 Pages rotate is not cheap/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});
