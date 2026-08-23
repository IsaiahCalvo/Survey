import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPageSize,
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';
import { displayedBoxOrigin } from '../src/utils/svgBoundingBox.js';

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

test('live spec covers remapped-page br\/mtr, collapse, flip, undo-last-resize, 390, file.id', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-resize.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /remapper must swap viewBox/);
  assert.match(spec, /post-rotate br must grow size in swapped viewBox/);
  assert.match(spec, /mtr on the remapped page updates angle/);
  assert.match(spec, /MTR_OPTIONAL_SKIP|post-rotate mtr must update angle/);
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
