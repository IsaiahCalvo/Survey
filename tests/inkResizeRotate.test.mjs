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
import {
  applyPageAffineToInkObject,
  commitInkObjectResize,
} from '../src/utils/inkGeometryTransform.js';

// Source contracts for D-01 leftover: selected Pen / Highlighter ink
// bbox resize + canvas `mtr` rotate. Live proof:
// debug/scenarios/e2e-ink-resize-rotate.spec.mjs
// Distinct from D-01/D-02 live stroke create, rect/ellipse/textbox/cloud
// transform, leftover-18. Counter has no separate bbox/mtr. Keyboard
// nudge is not wired. Insert image / stamp create has no path.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('ink affine resize + path overlay + mtr stay wired', () => {
  assert.deepEqual(ALL_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br', 'mt', 'mb', 'ml', 'mr']);
  assert.deepEqual(CORNER_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br']);
  assert.deepEqual(SIDE_RESIZE_HANDLES, ['mt', 'mb', 'ml', 'mr']);
  assert.equal(shouldShowSelectionTransformHandles({}), true);
  assert.equal(shouldShowSelectionTransformHandles({ isGroupSelection: true }), false);
  assert.equal(shouldShowSelectionTransformHandles({ moveOnly: true }), false);

  assert.equal(Math.round(normalizeAngle(Math.atan2(-1, 0))), 0);
  assert.equal(Math.round(normalizeAngle(Math.atan2(0, 1))), 90);

  const seed = {
    type: 'path',
    left: 100,
    top: 80,
    width: 80,
    height: 40,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    sourceWidth: 16,
    path: [['M', 60, 60], ['L', 140, 100]],
    pathOffset: { x: 100, y: 80 },
  };
  const grown = applyPageAffineToInkObject(seed, [1.5, 0, 0, 1.4, 20, 10]);
  assert.ok(grown.scaleX > seed.scaleX, 'affine grow writes scaleX');
  assert.ok(Math.abs(grown.scaleY) > 0, 'affine grow keeps |scaleY|');
  assert.equal(grown.sourceWidth, 16, 'affine must hold sourceWidth');
  assert.deepEqual(grown.path, seed.path, 'affine prefers transform fields over baking path');

  const committed = commitInkObjectResize(grown, {
    scaleX: 2,
    scaleY: 1.5,
    visibleLeft: 40,
    visibleTop: 30,
  });
  assert.ok(committed.scaleX >= 0.01);
  assert.ok(committed.scaleY >= 0.01);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /applyPageAffineToInkObject\(/);
  assert.match(hook, /commitInkObjectResize\(/);
  assert.match(hook, /pathResizePageMatrix/);
  assert.match(hook, /handleId === 'mtr' \? 'rotate'/);
  assert.match(hook, /action: 'scale'/);
  assert.match(hook, /action: 'rotate'/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /data-path-hit-target="true"/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /No dashed bbox, no resize handles — Shottr-style minimal chrome/);
  assert.match(layer, /data-counter-nubbin-handle="true"/);

  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /data-resize-handle=\{id\}/);
  assert.match(overlay, /data-rotation-handle="mtr"/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /e\.key === 'ArrowLeft' && !isFormField/);
  assert.match(viewer, /goToPreviousPage\(\)/);
  assert.match(viewer, /e\.key === 'ArrowRight' && !isFormField/);
  assert.match(viewer, /goToNextPage\(\)/);
  assert.doesNotMatch(viewer, /nudgeSelected|moveSelectedAnnotation|keyboardNudge/);
  assert.match(viewer, /const showTextMarkupHighlightMenu = false/);
  assert.doesNotMatch(viewer, /setActiveTool\('stamp'\)/);
  assert.doesNotMatch(viewer, /setActiveTool\('image'\)/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /\{false && \(/);
  assert.match(shell, /data-testid="forms-category-button"/);

  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderers, /export const renderPath/);
  assert.match(renderers, /transform \+= ` rotate\(\$\{angle\}, \$\{rotCenterX\}, \$\{rotCenterY\}\)`/);

  const transform = read('src/utils/inkGeometryTransform.js');
  assert.match(transform, /export function applyPageAffineToInkObject/);
  assert.match(transform, /export function commitInkObjectResize/);
  assert.match(transform, /scaleY: Math\.abs\(signedScaleY\)/);

  const svgKeys = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svgKeys, /if \(e\.key !== 'Delete' && e\.key !== 'Backspace'\) return/);
  assert.doesNotMatch(svgKeys, /e\.key === 'ArrowUp'[\s\S]{0,80}left \+/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers ink br\/mr\/mb / affine hold / mtr 90\/180 / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-ink-resize-rotate.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop ink resize \+ rotate intended \+ break \+ edge/);
  assert.match(spec, /390 ink resize \+ rotate intended \+ break \+ edge/);
  assert.match(spec, /empty Select shows 0 handles/);
  assert.match(spec, /empty page mtr 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /intended create A then B/);
  assert.match(spec, /A is Pen ink/);
  assert.match(spec, /B is Highlighter ink/);
  assert.match(spec, /A type is path/);
  assert.match(spec, /B stamps multiply/);
  assert.match(spec, /single-click ink shows all 8 handles/);
  assert.match(spec, /single-select A must show mtr/);
  assert.match(spec, /no counter nubbin seam/);
  assert.match(spec, /no cloud-rect seam/);
  assert.match(spec, /A visible width uses width\*\|sx\|/);
  assert.match(spec, /br must grow A width and height/);
  assert.match(spec, /br must keep A as path/);
  assert.match(spec, /br must hold A sourceWidth \(not Width catalog\)/);
  assert.match(spec, /br must isolate B multiply/);
  assert.match(spec, /undo must restore A size/);
  assert.match(spec, /redo must restore resized A/);
  assert.match(spec, /mr must grow A width only/);
  assert.match(spec, /mb must grow A height only/);
  assert.match(spec, /Shift\+br must keep aspect/);
  assert.match(spec, /flip past opposite must move origin and keep size/);
  assert.match(spec, /collapse must keep a visible width/);
  assert.match(spec, /free mtr drag must set A near 90°/);
  assert.match(spec, /mtr rotate must hold A width/);
  assert.match(spec, /mtr rotate must hold A sourceWidth/);
  assert.match(spec, /mtr rotate must isolate B multiply/);
  assert.match(spec, /undo must restore A angle 0/);
  assert.match(spec, /redo must restore rotated A/);
  assert.match(spec, /free mtr drag must set A near 180°/);
  assert.match(spec, /micro-drag must not commit angle/);
  assert.match(spec, /group moveOnly hides mtr/);
  assert.match(spec, /Line single-click mtr 0/);
  assert.match(spec, /deselect hides handles/);
  assert.match(spec, /selected Highlighter shows all 8 handles/);
  assert.match(spec, /Highlighter resize must hold multiply/);
  assert.match(spec, /390 br must grow A width and height/);
  assert.match(spec, /390 br must keep path/);
  assert.match(spec, /390 free mtr drag must set A near 90°/);
  assert.match(spec, /390 group moveOnly hides mtr/);
  assert.match(spec, /390 deselect hides handles/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('ink transform is not live-stroke\/shape replay / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-ink-resize-rotate.spec.mjs');
  assert.match(spec, /D-01 leftover: selected Pen \/ Highlighter ink/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.match(spec, /applyPageAffineToInkObject/);
  assert.match(spec, /createInk\(page, INK_A, \{ tool: 'Pen'/);
  assert.match(spec, /createInk\(page, INK_B, \{ tool: 'Highlighter'/);
  assert.match(spec, /data-path-hit-target="true"/);
  assert.doesNotMatch(spec, /pickDesktopStyle\(page, 'Cloud'\)/);
  assert.doesNotMatch(spec, /activateTool\(page, 'Shapes', 'Ellipse'\)/);
  assert.doesNotMatch(spec, /activateTool\(page, 'Text', 'Text'\)/);
  assert.doesNotMatch(spec, /activateTool\(page, 'Text', 'Callout'\)/);
  assert.doesNotMatch(spec, /Rotation angle in degrees|Match fill|Zoom percentage|Jump to page/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /freehand-creation-preview/);
  assert.doesNotMatch(spec, /dragResizeHandle\(page, 'textBox-/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.doesNotMatch(hook, /file\.id\s*=/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
