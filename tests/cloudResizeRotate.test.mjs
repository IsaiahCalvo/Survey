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
import { buildCloudPathCommands } from '../src/utils/pdfAnnotationImporter.js';

// Source contracts for S-01 leftover: selected Style→Cloud (`cloud-rect`)
// bbox resize + canvas `mtr` rotate. Live proof:
// debug/scenarios/e2e-cloud-resize-rotate.spec.mjs
// Distinct from Cloud bump 1–20, Cloud Fill/Border, Style catalog,
// solid-rect / ellipse / textbox transform, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('cloud-rect live path rebuild + rect flip + mtr stay wired', () => {
  assert.deepEqual(ALL_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br', 'mt', 'mb', 'ml', 'mr']);
  assert.deepEqual(CORNER_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br']);
  assert.deepEqual(SIDE_RESIZE_HANDLES, ['mt', 'mb', 'ml', 'mr']);
  assert.equal(shouldShowSelectionTransformHandles({}), true);
  assert.equal(shouldShowSelectionTransformHandles({ isGroupSelection: true }), false);
  assert.equal(shouldShowSelectionTransformHandles({ moveOnly: true }), false);

  assert.equal(Math.round(normalizeAngle(Math.atan2(-1, 0))), 0);
  assert.equal(Math.round(normalizeAngle(Math.atan2(0, 1))), 90);

  const small = buildCloudPathCommands(
    [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 60 }, { x: 0, y: 60 }],
    5,
    1,
  );
  const large = buildCloudPathCommands(
    [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 140 }, { x: 0, y: 140 }],
    5,
    1,
  );
  assert.ok(Array.isArray(small) && small.length > 4, 'small cloud emits commands');
  assert.ok(Array.isArray(large) && large.length > small.length, 'grow box adds humps');
  const smallD = small.map((seg) => seg.join(' ')).join(' ');
  const largeD = large.map((seg) => seg.join(' ')).join(' ');
  assert.notEqual(smallD, largeD);
  assert.ok(largeD.length > smallD.length);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /typeForFlip === 'rect'/);
  assert.match(hook, /typeForFlip === 'ellipse'/);
  assert.match(hook, /handleId === 'mtr' \? 'rotate'/);
  assert.match(hook, /action: 'scale'/);
  assert.match(hook, /action: 'rotate'/);
  assert.match(hook, /obj\.scaleX = Math\.abs\(newScaleX\)/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /data-shape-hit-target="rect"/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(layer, /zoomGeneration/);

  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /data-resize-handle=\{id\}/);
  assert.match(overlay, /data-rotation-handle="mtr"/);

  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderers, /Revision-cloud rectangles rebuild their scalloped path/);
  assert.match(renderers, /buildCloudPathCommands\(/);
  assert.match(renderers, /data-shape-kind="cloud-rect"/);
  assert.match(renderers, /effectiveWidth = Math\.abs\(\(obj\.width \|\| 0\) \* \(obj\.scaleX \|\| 1\)\)/);
  assert.match(renderers, /obj\.angle \? ` rotate\(\$\{obj\.angle\}, \$\{effectiveWidth \/ 2\}, \$\{effectiveHeight \/ 2\}\)`/);

  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /export function buildCloudPathCommands/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers cloud-rect br\/mr\/mb / path rebuild / mtr 90\/180 / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-cloud-resize-rotate.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop cloud-rect resize \+ rotate intended \+ break \+ edge/);
  assert.match(spec, /390 cloud-rect resize \+ rotate intended \+ break \+ edge/);
  assert.match(spec, /empty Select shows 0 handles/);
  assert.match(spec, /empty page mtr 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /intended create A then B/);
  assert.match(spec, /A is cloud-rect/);
  assert.match(spec, /A stores pdfCloudIntensity/);
  assert.match(spec, /single-click cloud shows all 8 handles/);
  assert.match(spec, /single-select A must show mtr/);
  assert.match(spec, /no callout textBox-br seam/);
  assert.match(spec, /selected cloud keeps bump field \(not replayed\)/);
  assert.match(spec, /A visible width uses width\*\|sx\|/);
  assert.match(spec, /br must grow A width and height/);
  assert.match(spec, /br must keep A as cloud-rect/);
  assert.match(spec, /br must hold A intensity \(not bump catalog\)/);
  assert.match(spec, /br must rebuild the live cloud path/);
  assert.match(spec, /br grow must lengthen the scalloped path/);
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
  assert.match(spec, /mtr rotate must keep cloud-rect/);
  assert.match(spec, /mtr rotate must hold intensity/);
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
  assert.match(spec, /390 br must keep cloud-rect/);
  assert.match(spec, /390 br must rebuild the cloud path/);
  assert.match(spec, /390 resize must isolate B/);
  assert.match(spec, /390 free mtr drag must set A near 90°/);
  assert.match(spec, /390 group moveOnly hides mtr/);
  assert.match(spec, /390 deselect hides handles/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('cloud transform is not bump\/color\/solid-rect replay / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-cloud-resize-rotate.spec.mjs');
  assert.match(spec, /S-01 leftover: selected Style→Cloud/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.match(spec, /pickDesktopStyle\(page, 'Cloud'\)/);
  assert.match(spec, /pickMobileStyle\(page, 'Cloud'\)/);
  assert.match(spec, /data-shape-kind="cloud-rect"/);
  assert.doesNotMatch(spec, /setBump|Cloud bump size.*fill\(/);
  assert.doesNotMatch(spec, /activateTool\(page, 'Shapes', 'Ellipse'\)/);
  assert.doesNotMatch(spec, /activateTool\(page, 'Text', 'Text'\)/);
  assert.doesNotMatch(spec, /activateTool\(page, 'Text', 'Callout'\)/);
  assert.doesNotMatch(spec, /Rotation angle in degrees|Match fill|Zoom percentage|Jump to page/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /dragResizeHandle\(page, 'textBox-/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.doesNotMatch(hook, /file\.id\s*=/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
