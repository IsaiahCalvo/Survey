import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAngle, snapAngleToNearest45 } from '../src/utils/svgTransformMath.js';
import { shouldShowSelectionTransformHandles } from '../src/utils/selectionHandleVisibility.js';

// Source contracts for E-02 leftover: canvas `mtr` free-drag rotate.
// Live proof: debug/scenarios/e2e-annotation-rotate.spec.mjs
// Distinct from typed pill, Shift+45 sample, survey-marker mtr,
// counter nubbin, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('mtr rotate math + group moveOnly stay wired', () => {
  // Fabric-convention: pointer above center is 0° (normalizeAngle adds +90).
  assert.equal(Math.round(normalizeAngle(Math.atan2(-1, 0))), 0);
  assert.equal(Math.round(normalizeAngle(Math.atan2(0, 1))), 90);
  assert.equal(Math.round(normalizeAngle(Math.atan2(1, 0))), 180);
  assert.equal(Math.round(normalizeAngle(Math.atan2(0, -1))), 270);

  assert.equal(snapAngleToNearest45(44, 3), 45);
  assert.equal(snapAngleToNearest45(23, 3), 23);
  assert.equal(shouldShowSelectionTransformHandles({ moveOnly: true }), false);

  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /data-rotation-handle="mtr"/);
  assert.match(overlay, /onHandleDrag\?\.\(e, 'mtr'\)/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /handleId === 'mtr' \? 'rotate'/);
  assert.match(hook, /ds\.mode === 'rotate'/);
  assert.match(hook, /handleId === 'mtr'/);
  assert.match(hook, /if \(e\.shiftKey\) \{\s*newAngle = snapAngleToNearest45\(newAngle, 3\)/);
  assert.match(hook, /rotObj\.angle = ds\.currentAngle/);
  assert.match(hook, /action: 'rotate'/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);
  assert.match(layer, /moveOnly=\{true\}/);
  assert.match(layer, /Group rotate \/ group resize handles are hidden/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers free 90\/180 / group hide / Line omit / Pen / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-annotation-rotate.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop annotation rotate intended \+ break \+ edge/);
  assert.match(spec, /390 annotation rotate intended \+ break \+ edge/);
  assert.match(spec, /empty page mtr 0/);
  assert.match(spec, /empty Select drag invents 0/);
  assert.match(spec, /intended create A then B/);
  assert.match(spec, /single-select A must show mtr/);
  assert.match(spec, /free mtr drag must set A near 90°/);
  assert.match(spec, /mtr rotate must hold A width/);
  assert.match(spec, /mtr rotate must isolate B angle/);
  assert.match(spec, /undo must restore A angle 0/);
  assert.match(spec, /redo must restore rotated A/);
  assert.match(spec, /free mtr drag must set A near 180°/);
  assert.match(spec, /micro-drag must not commit angle/);
  assert.match(spec, /group moveOnly hides mtr/);
  assert.match(spec, /Line single-click mtr 0/);
  assert.match(spec, /Pen drag must invent ink/);
  assert.match(spec, /Pen drag must not rotate A/);
  assert.match(spec, /390 free mtr drag must set A near 90°/);
  assert.match(spec, /390 window marquee must select A\+B/);
  assert.match(spec, /390 group moveOnly hides mtr/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
});

test('rotate is not resize / pill / leftover-18 hosts', () => {
  const spec = read('debug/scenarios/e2e-annotation-rotate.spec.mjs');
  assert.match(spec, /E-02 leftover: selected-annotation canvas rotate/);
  assert.match(spec, /Distinct from leftover-18/);
  assert.doesNotMatch(spec, /Rotation angle in degrees|Match fill|Zoom percentage|Jump to page/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /dragResizeHandle|data-resize-handle="br"/);

  const hook = read('src/hooks/useSVGInteraction.js');
  assert.doesNotMatch(hook, /file\.id\s*=/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /zoomGeneration/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
});
