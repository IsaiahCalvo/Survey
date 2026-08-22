import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Counter nubbin + Shift-orbit leftover after bbox edit mode.
// Live proof: debug/scenarios/e2e-counter-nubbin-orbit.spec.mjs
// Not Size/Start, not series Delete, not double-click bbox.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('selection nubbin sits on the tip and commits pointerAngle on pointerup', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /nubbin tip/);
  assert.match(layer, /data\.pointerAngle/);
  assert.match(layer, /data-counter-nubbin-handle="true"/);
  assert.match(layer, /const commitCounterHandlePreview = useCallback/);
  assert.match(layer, /source: 'counter:rotate-commit'/);
  assert.match(layer, /if \(preview && preview\.annotationIndex === selectedIndex\) \{\s*commitCounterHandlePreview\(preview\);/);
  assert.match(layer, /const newAngleDeg = Math\.atan2\(py - drag\.centerY, px - drag\.centerX\) \* 180 \/ Math\.PI/);
  assert.doesNotMatch(layer, /data-handle=["']nubbin["']/);
  assert.doesNotMatch(layer, /data-handle=["']vertex-N["']/);
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
});

test('Shift-drag on a committed counter enters orbit around the frozen tip', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /mode: 'counter-orbit'/);
  assert.match(hook, /e\.shiftKey/);
  assert.match(hook, /_obj_precheck\?\.data\?\.type === 'counter'/);
  assert.match(hook, /source: 'counter:orbit-commit'/);
  assert.match(hook, /const movedFar = \(moveDx \* moveDx \+ moveDy \* moveDy\) > 9/);
  assert.match(hook, /const newAngleDeg = \(\(Math\.atan2\(-dirY, -dirX\) \* 180 \/ Math\.PI\) \+ 360\) % 360/);
  assert.match(hook, /releasing Shift mid-orbit swaps back to move mode/);
  assert.doesNotMatch(hook, /pause-to-orbit|pauseToOrbit/);
});

test('place-time Shift freezes the tip; 390 has no distinct pause-orbit', () => {
  const viewer = read('src/PDFViewer.jsx');
  const chrome = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(viewer, /Shift-rotate mode: TIP frozen/);
  assert.match(viewer, /drag\.shiftActive/);
  assert.match(viewer, /pointerAngle: angleDeg/);
  assert.match(viewer, /Lock the tip at its CURRENT canvas position so the body can orbit/);
  assert.doesNotMatch(viewer, /pause-to-orbit|pauseToOrbit|Gesture\.LongPress/);
  assert.doesNotMatch(chrome, /pause-to-orbit|nubbin|pointerAngle/);
});
