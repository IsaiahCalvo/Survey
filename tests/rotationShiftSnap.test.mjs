import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { snapAngleToNearest45 } from '../src/utils/svgTransformMath.js';
import { shouldShowSelectionTransformHandles } from '../src/utils/selectionHandleVisibility.js';

// Source contracts for E-02 leftover: canvas `mtr` Shift+45° soft snap.
// Live proof: debug/scenarios/e2e-rotation-shift-snap.spec.mjs
// Distinct from free-drag 90/180, typed pill, group-rotate 15°,
// survey-marker mtr, counter nubbin, leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('soft 3° threshold snaps 44/47/89 and leaves 23/41', () => {
  assert.equal(snapAngleToNearest45(44, 3), 45);
  assert.equal(snapAngleToNearest45(47, 3), 45);
  assert.equal(snapAngleToNearest45(89, 3), 90);
  assert.equal(snapAngleToNearest45(23, 3), 23);
  assert.equal(snapAngleToNearest45(41, 3), 41);
  assert.equal(snapAngleToNearest45(358, 3), 0);
  assert.equal(shouldShowSelectionTransformHandles({ moveOnly: true }), false);
});

test('rotate path applies snap only while Shift is held; group hides mtr', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /EDIT-11: soft Shift-snap to nearest 45° within 3° threshold/);
  assert.match(hook, /if \(e\.shiftKey\) \{\s*newAngle = snapAngleToNearest45\(newAngle, 3\)/);
  assert.match(hook, /Soft Shift snap to nearest 15° within 3° threshold/);
  assert.match(hook, /handleId === 'mtr' \? 'rotate'/);
  assert.match(hook, /ds\.mode === 'rotate'/);

  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /data-rotation-handle="mtr"/);
  assert.match(overlay, /moveOnly takes precedence \(hides everything\)/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /moveOnly=\{true\}/);
  assert.match(layer, /Group rotate \/ group resize handles are hidden/);
  assert.doesNotMatch(layer, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});

test('live spec covers Shift 44→45 / 89→90 / bare 44 / far 23 / group hide / 390 / file.id', () => {
  const spec = read('debug/scenarios/e2e-rotation-shift-snap.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Shift\+45 rotation snap intended \+ break \+ edge/);
  assert.match(spec, /390 Shift\+45 rotation snap intended \+ break \+ edge/);
  assert.match(spec, /bare 44° drag must not snap to 45/);
  assert.match(spec, /Shift\+44 must snap A to 45°/);
  assert.match(spec, /Shift\+89 must snap A to 90°/);
  assert.match(spec, /Shift\+23 must not invent a cardinal snap/);
  assert.match(spec, /Shift micro-drag must not commit angle/);
  assert.match(spec, /group moveOnly hides mtr/);
  assert.match(spec, /Line single-click mtr 0/);
  assert.match(spec, /Pen drag must invent ink/);
  assert.match(spec, /390 Shift\+44 must snap A to 45°/);
  assert.match(spec, /390 bare 44° drag must not snap to 45/);
  assert.match(spec, /390 group moveOnly hides mtr/);
  assert.match(spec, /viewBox/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /Rotation angle in degrees|Match fill|Zoom percentage/);
  assert.doesNotMatch(spec, /setActiveTool\('pan'\)|keyboard\.down\('Space'\)/);
  assert.doesNotMatch(spec, /dragResizeHandle|data-resize-handle="br"/);
});
