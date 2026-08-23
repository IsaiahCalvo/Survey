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

// Source contracts for E-01 leftover: single-click rect bbox resize.
// Live proof: debug/scenarios/e2e-annotation-resize.spec.mjs
// Distinct from E-02 rotation, E-03 move, T-02 callout corners,
// S-03/S-04 line endpoints, X-04 vertex-N, bbox-edit-mode,
// survey-marker handles, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('single-click resize handle names + group hide + flip floor stay wired', () => {
  assert.deepEqual(ALL_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br', 'mt', 'mb', 'ml', 'mr']);
  assert.deepEqual(CORNER_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br']);
  assert.deepEqual(SIDE_RESIZE_HANDLES, ['mt', 'mb', 'ml', 'mr']);
  assert.equal(shouldShowSelectionTransformHandles({}), true);
  assert.equal(shouldShowSelectionTransformHandles({ isGroupSelection: true }), false);
  assert.equal(shouldShowSelectionTransformHandles({ moveOnly: true }), false);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /ds\.mode === 'resize'/);
  assert.match(hook, /const mode = handleId === 'mtr' \? 'rotate' : 'resize'/);
  assert.match(hook, /const affectsX = !\['mt', 'mb'\]\.includes\(ds\.handleId\)/);
  assert.match(hook, /const affectsY = !\['ml', 'mr'\]\.includes\(ds\.handleId\)/);
  assert.match(hook, /const isLeftHandle = \['tl', 'ml', 'bl'\]\.includes\(ds\.handleId\)/);
  assert.match(hook, /const isTopHandle = \['tl', 'mt', 'tr'\]\.includes\(ds\.handleId\)/);
  assert.match(hook, /Shift-lock aspect ratio/);
  assert.match(hook, /if \(Math\.abs\(newScaleX\) < 0\.01\) newScaleX = \(newScaleX < 0 \? -1 : 1\) \* 0\.01/);
  assert.match(hook, /typeForFlip === 'rect'/);
  assert.match(hook, /obj\.scaleX = Math\.abs\(newScaleX\)/);
  assert.match(hook, /obj\.scaleY = Math\.abs\(newScaleY\)/);
  assert.match(hook, /action: 'scale'/);
  assert.match(hook, /br: \{ x: bbox\.left, y: bbox\.top \}/);
  assert.match(hook, /mr: \{ x: bbox\.left, y: cy \}/);
  assert.match(hook, /mb: \{ x: cx, y: bbox\.top \}/);

  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /data-resize-handle=\{id\}/);
  assert.match(overlay, /const cornerHandles = \['tl', 'tr', 'bl', 'br'\]/);
  assert.match(overlay, /\['mt', 'mb'\]/);
  assert.match(overlay, /\['ml', 'mr'\]/);
  assert.match(overlay, /isGroupSelection/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(layer, /zoomGeneration/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers br\/mr\/mb / Shift / flip / collapse / Pen / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-annotation-resize.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop annotation resize intended \+ break \+ edge/);
  assert.match(spec, /390 annotation resize intended \+ break \+ edge/);
  assert.match(spec, /empty Select shows 0 handles/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /intended create A then B/);
  assert.match(spec, /single-click rect shows all 8 handles/);
  assert.match(spec, /br must grow A width and height/);
  assert.match(spec, /br must pin A left/);
  assert.match(spec, /br must isolate B left/);
  assert.match(spec, /undo must restore A size/);
  assert.match(spec, /redo must restore resized A/);
  assert.match(spec, /mr must grow A width only/);
  assert.match(spec, /mb must grow A height only/);
  assert.match(spec, /Shift\+br must keep aspect/);
  assert.match(spec, /flip past opposite must move origin and keep size/);
  assert.match(spec, /flip commit stores \|scaleX\|/);
  assert.match(spec, /collapse must keep a visible width/);
  assert.match(spec, /deselect hides handles/);
  assert.match(spec, /Pen-armed handle still resizes A/);
  assert.match(spec, /Pen drag must invent ink/);
  assert.match(spec, /Pen drag must not resize A/);
  assert.match(spec, /390 br must grow A width and height/);
  assert.match(spec, /390 resize must isolate B/);
  assert.match(spec, /390 collapse must keep a visible width/);
  assert.match(spec, /390 deselect hides handles/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('resize is not move / rotation / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-annotation-resize.spec.mjs');
  assert.match(spec, /E-01 leftover: single-click rect bbox resize/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /Rotation angle in degrees|Match fill|Zoom percentage|Jump to page/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /constrainToPage|group-move/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.doesNotMatch(hook, /file\.id\s*=/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
