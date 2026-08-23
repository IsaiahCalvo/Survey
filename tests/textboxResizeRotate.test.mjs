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

// Source contracts for T-01 leftover: selected textbox bbox resize
// + canvas `mtr` rotate. Live proof:
// debug/scenarios/e2e-textbox-resize-rotate.spec.mjs
// Distinct from T-01 create auto-edit, UL-36 Aa, T-02 callout corners,
// rect/ellipse transform, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('textbox bake-width + no-flip 0.1 floor + mtr stay wired', () => {
  assert.deepEqual(ALL_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br', 'mt', 'mb', 'ml', 'mr']);
  assert.deepEqual(CORNER_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br']);
  assert.deepEqual(SIDE_RESIZE_HANDLES, ['mt', 'mb', 'ml', 'mr']);
  assert.equal(shouldShowSelectionTransformHandles({}), true);
  assert.equal(shouldShowSelectionTransformHandles({ isGroupSelection: true }), false);
  assert.equal(shouldShowSelectionTransformHandles({ moveOnly: true }), false);

  assert.equal(Math.round(normalizeAngle(Math.atan2(-1, 0))), 0);
  assert.equal(Math.round(normalizeAngle(Math.atan2(0, 1))), 90);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /objType === 'textbox' \|\| objType === 'i-text' \|\| objType === 'text'/);
  assert.match(hook, /absorb scale into width\/height so text reflows/);
  assert.match(hook, /text does not support flip \(scale is clamped positive upstream\)/);
  assert.match(hook, /obj\.width = \(obj\.width \|\| 100\) \* \(newScaleX \/ \(ds\.originalProps\.scaleX \|\| 1\)\)/);
  assert.match(hook, /obj\.scaleX = 1;\s*\n\s*obj\.scaleY = 1;/);
  assert.match(hook, /\} else if \(!supportsFlip\) \{\s*\n\s*newScaleX = Math\.max\(0\.1, newScaleX\);/);
  assert.match(hook, /typeForFlip === 'rect'/);
  assert.match(hook, /typeForFlip === 'ellipse'/);
  assert.doesNotMatch(hook, /typeForFlip === 'textbox'/);
  assert.match(hook, /handleId === 'mtr' \? 'rotate'/);
  assert.match(hook, /action: 'scale'/);
  assert.match(hook, /action: 'rotate'/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /TEXT_EDIT_TYPES = new Set\(\['textbox', 'i-text', 'text'\]\)/);
  assert.match(layer, /objectType === 'textbox' \|\|/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(layer, /zoomGeneration/);

  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /data-resize-handle=\{id\}/);
  assert.match(overlay, /data-rotation-handle="mtr"/);

  const renderers = read('src/utils/svgAnnotationRenderers.jsx');
  assert.match(renderers, /DEFAULT_FONT_FAMILY|fontFamily.*Helvetica|obj\.fontFamily/);
  assert.match(renderers, /effectiveWidth = obj\.width \* scaleX/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers textbox br\/mr\/mb / bake / no-flip / mtr 90\/180 / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-textbox-resize-rotate.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop textbox resize \+ rotate intended \+ break \+ edge/);
  assert.match(spec, /390 textbox resize \+ rotate intended \+ break \+ edge/);
  assert.match(spec, /empty Select shows 0 handles/);
  assert.match(spec, /empty page mtr 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /intended create A then B/);
  assert.match(spec, /A is textbox/);
  assert.match(spec, /A fontFamily must be a single name/);
  assert.match(spec, /single-click textbox shows all 8 handles/);
  assert.match(spec, /single-select A must show mtr/);
  assert.match(spec, /single-click must stay out of edit/);
  assert.match(spec, /no callout textBox-br seam/);
  assert.match(spec, /A visible width uses width\*\|sx\|/);
  assert.match(spec, /br must grow A width and height/);
  assert.match(spec, /br must bake width \(reflow, not stretch\)/);
  assert.match(spec, /br must reset scaleX to 1/);
  assert.match(spec, /br must isolate B left/);
  assert.match(spec, /undo must restore A size/);
  assert.match(spec, /redo must restore resized A/);
  assert.match(spec, /mr must grow A width only/);
  assert.match(spec, /mb must grow A height only/);
  assert.match(spec, /Shift\+br must keep aspect/);
  assert.match(spec, /overshoot must pin A left \(no flip\)/);
  assert.match(spec, /overshoot must floor above zero/);
  assert.match(spec, /overshoot must not store negative scaleX/);
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
  assert.match(spec, /390 br must bake width/);
  assert.match(spec, /390 resize must isolate B/);
  assert.match(spec, /390 free mtr drag must set A near 90°/);
  assert.match(spec, /390 group moveOnly hides mtr/);
  assert.match(spec, /390 deselect hides handles/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('textbox transform is not T-01 create-edit replay / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-textbox-resize-rotate.spec.mjs');
  assert.match(spec, /T-01 leftover: selected textbox bbox resize/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.match(spec, /activateTool\(page, 'Text', 'Text'\)/);
  assert.match(spec, /data-text-edit-overlay/);
  assert.doesNotMatch(spec, /activateTool\(page, 'Shapes', 'Rectangle'\)/);
  assert.doesNotMatch(spec, /activateTool\(page, 'Shapes', 'Ellipse'\)/);
  assert.doesNotMatch(spec, /Rotation angle in degrees|Match fill|Zoom percentage|Jump to page/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /pressSequentially\('Hello'/);
  assert.doesNotMatch(spec, /dragResizeHandle\(page, 'textBox-/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.doesNotMatch(hook, /file\.id\s*=/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
