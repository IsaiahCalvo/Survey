import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_RESIZE_HANDLES,
  CORNER_RESIZE_HANDLES,
  SIDE_RESIZE_HANDLES,
  shouldShowSelectionTransformHandles,
} from '../src/utils/selectionHandleVisibility.js';
import { normalizeAngle } from '../src/utils/svgTransformMath.js';

// Source contracts for E-01 / E-02 leftover: selected ellipse bbox resize
// + canvas `mtr` rotate. Live proof:
// debug/scenarios/e2e-ellipse-resize-rotate.spec.mjs
// Distinct from rect e2e-annotation-resize / e2e-annotation-rotate,
// ellipse dash, export-scale flatten, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('ellipse / circle share rect flip + rx*2 raw dims + mtr', () => {
  assert.deepEqual(ALL_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br', 'mt', 'mb', 'ml', 'mr']);
  assert.deepEqual(CORNER_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br']);
  assert.deepEqual(SIDE_RESIZE_HANDLES, ['mt', 'mb', 'ml', 'mr']);
  assert.equal(shouldShowSelectionTransformHandles({}), true);
  assert.equal(shouldShowSelectionTransformHandles({ isGroupSelection: true }), false);
  assert.equal(shouldShowSelectionTransformHandles({ moveOnly: true }), false);

  assert.equal(Math.round(normalizeAngle(Math.atan2(-1, 0))), 0);
  assert.equal(Math.round(normalizeAngle(Math.atan2(0, 1))), 90);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /typeForFlip === 'ellipse'/);
  assert.match(hook, /typeForFlip === 'circle'/);
  assert.match(hook, /typeForFlip === 'rect'/);
  assert.match(hook, /\} else if \(type === 'ellipse'\) \{\s*rawWidth = \(obj\.rx \?\? 0\) \* 2;\s*rawHeight = \(obj\.ry \?\? 0\) \* 2;/);
  assert.match(hook, /\} else if \(type === 'circle'\) \{\s*rawWidth = \(obj\.radius \?\? 0\) \* 2;/);
  assert.match(hook, /circle\/ellipse a mirrored shape is visually identical/);
  assert.match(hook, /obj\.scaleX = Math\.abs\(newScaleX\)/);
  assert.match(hook, /handleId === 'mtr' \? 'rotate'/);
  assert.match(hook, /action: 'scale'/);
  assert.match(hook, /action: 'rotate'/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /data-shape-hit-target=\{objTypeLower\}/);
  assert.match(layer, /objTypeLower === 'circle' \|\| objTypeLower === 'ellipse'/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(layer, /zoomGeneration/);

  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /data-resize-handle=\{id\}/);
  assert.match(overlay, /data-rotation-handle="mtr"/);

  const commit = read('src/utils/shapeCommitGeometry.js');
  assert.match(commit, /if \(tool === 'ellipse'\)/);
  assert.match(commit, /rx: Math\.max\(0, width \/ 2 - inset\)/);
  assert.match(commit, /ry: Math\.max\(0, height \/ 2 - inset\)/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers ellipse br\/mr\/mb / mtr 90\/180 / Shift / flip / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-ellipse-resize-rotate.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop ellipse resize \+ rotate intended \+ break \+ edge/);
  assert.match(spec, /390 ellipse resize \+ rotate intended \+ break \+ edge/);
  assert.match(spec, /empty Select shows 0 handles/);
  assert.match(spec, /empty page mtr 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /intended create A then B/);
  assert.match(spec, /A is ellipse/);
  assert.match(spec, /A stores rx not only width/);
  assert.match(spec, /single-click ellipse shows all 8 handles/);
  assert.match(spec, /single-select A must show mtr/);
  assert.match(spec, /A visible width uses rx\*2\*\|sx\|/);
  assert.match(spec, /br must grow A width and height/);
  assert.match(spec, /br must hold raw rx \(scale grows\)/);
  assert.match(spec, /br must isolate B left/);
  assert.match(spec, /undo must restore A size/);
  assert.match(spec, /redo must restore resized A/);
  assert.match(spec, /mr must grow A width only/);
  assert.match(spec, /mb must grow A height only/);
  assert.match(spec, /Shift\+br must keep aspect/);
  assert.match(spec, /flip past opposite must move origin and keep size/);
  assert.match(spec, /flip commit stores \|scaleX\|/);
  assert.match(spec, /collapse must keep a visible width/);
  assert.match(spec, /free mtr drag must set A near 90°/);
  assert.match(spec, /mtr rotate must hold A width/);
  assert.match(spec, /mtr rotate must isolate B angle/);
  assert.match(spec, /undo must restore A angle 0/);
  assert.match(spec, /redo must restore rotated A/);
  assert.match(spec, /free mtr drag must set A near 180°/);
  assert.match(spec, /micro-drag must not commit angle/);
  assert.match(spec, /group moveOnly hides mtr/);
  assert.match(spec, /Line single-click mtr 0/);
  assert.match(spec, /deselect hides handles/);
  assert.match(spec, /Pen-armed handle still resizes A/);
  assert.match(spec, /Pen drag must invent ink/);
  assert.match(spec, /Pen drag must not resize A/);
  assert.match(spec, /Pen drag must not rotate A/);
  assert.match(spec, /390 br must grow A width and height/);
  assert.match(spec, /390 br must hold raw rx/);
  assert.match(spec, /390 resize must isolate B/);
  assert.match(spec, /390 free mtr drag must set A near 90°/);
  assert.match(spec, /390 group moveOnly hides mtr/);
  assert.match(spec, /390 deselect hides handles/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('ellipse transform is not rect replay / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-ellipse-resize-rotate.spec.mjs');
  assert.match(spec, /E-01 \/ E-02 leftover: selected ellipse bbox resize/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.match(spec, /Shapes', 'Ellipse'/);
  assert.match(spec, /data-shape-hit-target="ellipse"/);
  assert.doesNotMatch(spec, /activateTool\(page, 'Shapes', 'Rectangle'\)/);
  assert.doesNotMatch(spec, /Rotation angle in degrees|Match fill|Zoom percentage|Jump to page/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.doesNotMatch(hook, /file\.id\s*=/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
