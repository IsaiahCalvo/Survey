// Revision-cloud selection chrome vs Drawboard PDF — the defects an
// adversarial pass measured live in the in-app Browser pane on 2026-09-09
// (branch claude/verify2-chrome-drawboard), plus the four the owner's brief
// added, now pinned as the contract.
//
// (1) GRAB JUMP. The eight grabbers are DRAWN on the padded crown hull, but
//     the resize math wrote the object's own bbox edge to the ABSOLUTE pointer
//     position, so grabbing any grabber snapped the cloud outward by the hull
//     overhang before it tracked the cursor (live: inner width 120.15 ->
//     147.18 on a +12.5 pointer move; a plain rect tracked 1:1). The resize is
//     now offset-preserving: the grab-time pointer-to-edge offset is captured
//     once and subtracted on every move, so the box changes by exactly the
//     pointer delta. Same contract for the rotation handle.
// (2) GLOW ORDER. The glow was emitted inside the hit-target group, which
//     renders AFTER the ink, so a 2.85x-wide #4a90e2 stroke at 0.666 opacity
//     covered the user's stroke and a selected red cloud read blue. Drawboard
//     paints its highlight UNDER the ink; so does the underlay now.
// (3) GRABBER SET. SVGSelectionOverlay asked getAdaptiveSelectionHandleSpec
//     about the INNER box while drawing the grabbers on the frame, so a 45x45
//     cloud (frame 68.7 -> now 71.2) showed only four corners. The fit
//     question is now asked about the frame the grabbers live on.
// (4) POLY CHROME. A polygon / polyline cloud's single click showed vertex
//     dots only; the padded dashed frame now shows there too (dots stay the
//     only grabbers), and bbox mode derives its eight grabbers from the frame
//     so a 2-point polyline cloud (inner height 0) no longer collapses to a
//     lone 'br'.
// (5) FRAME PAD. cloudOutlineBounds samples the crown CENTRELINE, so padding
//     by one stroke width left only sw/2 of air and the 2px dashes kissed the
//     humps at 100%. The pad is now measured from the ink's OUTER edge plus a
//     full stroke width: 1.5 stroke widths from the centreline hull.
// (6) ENTER TO FINISH. Enter/Escape finish/cancel a click-to-place draft
//     wherever focus sits; only a real typing surface keeps those keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLOUD_FRAME_PAD_STROKE_RATIO,
  cloudSelectionChrome,
} from '../src/utils/cloudAnnotationGeometry.js';
import {
  ALL_RESIZE_HANDLES,
  getAdaptiveSelectionHandleSpec,
} from '../src/utils/selectionHandleVisibility.js';
import {
  resizeGrabOffset,
  rotationGrabOffsetDeg,
  worldResizeAnchor,
} from '../src/utils/offsetPreservingResize.js';
import { isTextEntryTarget } from '../src/utils/draftKeyboardTarget.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');

const CLOUD = { strokeWidth: 2.5, stroke: '#c42747', fill: 'transparent', data: { pdfCloudIntensity: 2 } };
const HANDLE_IDS = ['tl', 'mt', 'tr', 'mr', 'br', 'mb', 'bl', 'ml'];

// ---------------------------------------------------------------------------
// (3) GRABBER SET — the fit question belongs to the frame the grabbers sit on
// ---------------------------------------------------------------------------

test('cloud chrome: a cloud whose FRAME fits all eight grabbers must show all eight', () => {
  // The live case: a rectangle cloud drawn at 45.06 x 45.06 page units.
  const rect = { type: 'rect', left: 224, top: 716, width: 45.06, height: 45.06, ...CLOUD };
  const chrome = cloudSelectionChrome(rect);
  assert.ok(chrome, 'cloud chrome resolves');
  // The padded hull frame. Measured live at 68.72 x 68.72 when the pad was one
  // stroke width; defect 5 moved the pad to 1.5 stroke widths (measured from
  // the ink's OUTER edge), which grows the frame by sw on each axis. The
  // assertion is derived from the constant rather than re-pinning a literal,
  // so the number moves with the contract instead of freezing the old one.
  const hullWidth = chrome.frame.width - 2 * chrome.pad;
  assert.ok(Math.abs(hullWidth - 63.72446) < 0.01, `hull width ${hullWidth}`);
  assert.equal(chrome.pad, rect.strokeWidth * CLOUD_FRAME_PAD_STROKE_RATIO);
  assert.ok(chrome.frame.width > 71 && chrome.frame.width < 72, `frame width ${chrome.frame.width}`);

  // The frame has room for the corner circles AND the edge pills...
  const byFrame = getAdaptiveSelectionHandleSpec({
    bboxWidth: chrome.frame.width,
    bboxHeight: chrome.frame.height,
    inverseScale: 1,
    padding: 0,
  });
  assert.deepEqual(byFrame.resizeHandles, ALL_RESIZE_HANDLES);

  // ...and the inner box the cloud was drawn from does NOT — which is exactly
  // why the overlay must not ask the question about it. (This documents the
  // gap; the overlay's own wiring is asserted in the next test.)
  const byInnerBox = getAdaptiveSelectionHandleSpec({
    bboxWidth: rect.width,
    bboxHeight: rect.height,
    inverseScale: 1,
    padding: 0,
  });
  assert.notDeepEqual(
    byInnerBox.resizeHandles,
    ALL_RESIZE_HANDLES,
    'fixture must be a cloud whose inner box culls the edge pills but whose frame does not',
  );
});

test('cloud chrome: SVGSelectionOverlay sizes its handle tier from the cloud frame, not the inner bbox', () => {
  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  // `frame` is already computed in this component (frameRect || bbox), so the
  // fit question must be asked about it.
  assert.match(
    overlay,
    /getAdaptiveSelectionHandleSpec\(\{\s*bboxWidth:\s*frame\.width,\s*bboxHeight:\s*frame\.height/,
    'handle-visibility tier must be measured on the frame the grabbers are drawn on',
  );
});

test('cloud chrome: a 2-point polyline cloud is sized by its frame, never by the zero-height inner box', () => {
  const tierFor = (frame) => getAdaptiveSelectionHandleSpec({
    bboxWidth: frame.width, bboxHeight: frame.height, inverseScale: 1, padding: 0,
  }).resizeHandles;

  // Dead flat: the inner box has height 0, which collapsed the whole set to a
  // single 'br' grabber — the live symptom. Its crown frame is a real 20-unit
  // band, which carries the four corners.
  const flat = cloudSelectionChrome({
    type: 'polyline', left: 100, top: 100, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 150, y: 0 }], ...CLOUD,
  });
  assert.deepEqual(
    getAdaptiveSelectionHandleSpec({ bboxWidth: 150, bboxHeight: 0, inverseScale: 1, padding: 0 }).resizeHandles,
    ['br'],
    'the inner box is what used to produce the lone br',
  );
  assert.ok(flat.frame.height > 20, `flat polyline frame height ${flat.frame.height}`);
  assert.deepEqual(tierFor(flat.frame), ['tl', 'tr', 'bl', 'br']);
  // NOTE the honest limit: the app's adaptive tier drops the four edge pills
  // when the box cannot hold a 28-unit pill between two corner circles, and a
  // 20-unit-tall crown band genuinely cannot. Four corners (up from one) is
  // the frame's real answer; forcing eight would stack pills on corners. The
  // contract is "the FRAME decides", not "always eight".
  const sloped = cloudSelectionChrome({
    type: 'polyline', left: 100, top: 100, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 150, y: 70 }], ...CLOUD,
  });
  assert.deepEqual(tierFor(sloped.frame), ALL_RESIZE_HANDLES,
    'as soon as the frame has room, all eight appear');
});

// ---------------------------------------------------------------------------
// (2) GLOW ORDER
// ---------------------------------------------------------------------------

test('cloud chrome: the scallop glow paints UNDER the ink so the cloud keeps its own colour', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const glowAt = layer.indexOf('data-cloud-glow="true"');
  const inkAt = layer.indexOf('{renderElement}');
  assert.ok(glowAt > 0 && inkAt > 0, 'both markers found');
  assert.ok(
    glowAt < inkAt,
    'the cloud glow must be emitted in an underlay that paints before the visible ink '
    + '(it used to live in the hit-target group, which renders after {renderElement}, '
    + 'so 0.666-opacity blue covered the user\'s stroke while hovered or selected)',
  );
  assert.equal(
    (layer.match(/data-cloud-glow/g) || []).length, 1,
    'exactly one glow emitter — a second copy in the hit group would paint over the ink again',
  );
});

// ---------------------------------------------------------------------------
// (1) GRAB JUMP — offset-preserving resize + rotate
// ---------------------------------------------------------------------------

// Faithful transcription of the resize formula in useSVGInteraction's
// pointermove ('resize' branch), including the grab-offset subtraction. Kept
// here so the arithmetic contract ("+25 of pointer becomes +25 of box") can be
// asserted without a DOM; the hook's own wiring is asserted by source below.
const resizeStep = ({
  handleId, pointer, anchor, center, angleDeg = 0, width, height,
  scaleX = 1, scaleY = 1, grabOffset = null,
}) => {
  const affectsX = !['mt', 'mb'].includes(handleId);
  const affectsY = !['ml', 'mr'].includes(handleId);
  const isLeft = ['tl', 'ml', 'bl'].includes(handleId);
  const isTop = ['tl', 'mt', 'tr'].includes(handleId);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const world = worldResizeAnchor({
    anchorX: anchor.x, anchorY: anchor.y, centerX: center.x, centerY: center.y, angleDeg,
  });
  const pdx = pointer.x - world.x;
  const pdy = pointer.y - world.y;
  const lx = pdx * cos + pdy * sin;
  const ly = -pdx * sin + pdy * cos;
  let nsx = scaleX;
  let nsy = scaleY;
  if (affectsX && width !== 0) nsx = ((isLeft ? -lx : lx) - (grabOffset?.dx || 0)) / width;
  if (affectsY && height !== 0) nsy = ((isTop ? -ly : ly) - (grabOffset?.dy || 0)) / height;
  return { width: width * Math.abs(nsx), height: height * Math.abs(nsy) };
};

const anchorMapFor = (bbox) => {
  const cx = bbox.left + bbox.width / 2;
  const cy = bbox.top + bbox.height / 2;
  return {
    tl: { x: bbox.left + bbox.width, y: bbox.top + bbox.height },
    tr: { x: bbox.left, y: bbox.top + bbox.height },
    bl: { x: bbox.left + bbox.width, y: bbox.top },
    br: { x: bbox.left, y: bbox.top },
    mt: { x: cx, y: bbox.top + bbox.height },
    mb: { x: cx, y: bbox.top },
    ml: { x: bbox.left + bbox.width, y: cy },
    mr: { x: bbox.left, y: cy },
  };
};

const rotatePoint = (x, y, cx, cy, angleDeg) => {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
};

const assertOffsetPreservingResize = (label, obj, bbox, { angleDeg = 0, move = 25 } = {}) => {
  const chrome = cloudSelectionChrome(obj);
  assert.ok(chrome, `${label}: chrome resolves`);
  const center = { x: bbox.left + bbox.width / 2, y: bbox.top + bbox.height / 2 };
  const anchors = anchorMapFor(bbox);
  for (const handleId of HANDLE_IDS) {
    const affectsX = !['mt', 'mb'].includes(handleId);
    const affectsY = !['ml', 'mr'].includes(handleId);
    const isLeft = ['tl', 'ml', 'bl'].includes(handleId);
    const isTop = ['tl', 'mt', 'tr'].includes(handleId);
    // The grabber is drawn on the frame; the overlay rotates the whole group
    // about the cloud's own pivot, so its rendered position is the unrotated
    // frame anchor rotated by the cloud's angle.
    const drawn = angleDeg
      ? rotatePoint(chrome.anchors[handleId].x, chrome.anchors[handleId].y,
        chrome.rotationCenter.x, chrome.rotationCenter.y, angleDeg)
      : chrome.anchors[handleId];
    const common = {
      handleId, anchor: anchors[handleId], center, angleDeg,
      width: bbox.width, height: bbox.height,
    };
    const offset = resizeGrabOffset({
      ...common,
      pointerX: drawn.x,
      pointerY: drawn.y,
      anchorX: anchors[handleId].x,
      anchorY: anchors[handleId].y,
      centerX: center.x,
      centerY: center.y,
    });

    // No jump on grab: the box the math writes is unchanged at the instant the
    // grabber is picked up.
    const atGrab = resizeStep({ ...common, pointer: drawn, grabOffset: offset });
    assert.ok(Math.abs(atGrab.width - bbox.width) < 1e-6,
      `${label}.${handleId}: grabbing changed width by ${(atGrab.width - bbox.width).toFixed(4)}`);
    assert.ok(Math.abs(atGrab.height - bbox.height) < 1e-6,
      `${label}.${handleId}: grabbing changed height by ${(atGrab.height - bbox.height).toFixed(4)}`);

    // ...and the defect it replaces: without the offset the cloud snaps out by
    // the full hull overhang the instant it is grabbed.
    if (affectsX) {
      const raw = resizeStep({ ...common, pointer: drawn, grabOffset: null });
      assert.ok(raw.width - bbox.width > 5,
        `${label}.${handleId}: fixture must actually exhibit the old grab jump`);
    }

    // +move along the handle's own growth direction changes the box by exactly
    // +move on every axis that handle drives, and by nothing on the other.
    const dirX = affectsX ? (isLeft ? -1 : 1) : 0;
    const dirY = affectsY ? (isTop ? -1 : 1) : 0;
    const world = rotatePoint(dirX * move, dirY * move, 0, 0, angleDeg);
    const moved = resizeStep({
      ...common, pointer: { x: drawn.x + world.x, y: drawn.y + world.y }, grabOffset: offset,
    });
    assert.ok(Math.abs(moved.width - (bbox.width + (affectsX ? move : 0))) < 1e-6,
      `${label}.${handleId}: width tracked ${(moved.width - bbox.width).toFixed(4)}, want ${affectsX ? move : 0}`);
    assert.ok(Math.abs(moved.height - (bbox.height + (affectsY ? move : 0))) < 1e-6,
      `${label}.${handleId}: height tracked ${(moved.height - bbox.height).toFixed(4)}, want ${affectsY ? move : 0}`);
  }
};

test('grab jump: every rect-cloud grabber is offset-preserving — no snap, +25 pointer = +25 box', () => {
  const rect = { type: 'rect', left: 224, top: 716, width: 120.15, height: 88, ...CLOUD };
  assertOffsetPreservingResize('rect', rect, { left: 224, top: 716, width: 120.15, height: 88 });
});

test('grab jump: an ELLIPSE cloud (raw dims from rx/ry) tracks 1:1 too', () => {
  const ellipse = { type: 'ellipse', left: 300, top: 200, rx: 90, ry: 55, ...CLOUD };
  // getAnnotationBBox for an ellipse: left/top + rx*2 / ry*2.
  assertOffsetPreservingResize('ellipse', ellipse, { left: 300, top: 200, width: 180, height: 110 });
});

test('grab jump: a ROTATED (35 deg) cloud resizes along its own axes with no skew', () => {
  const rect = {
    type: 'rect', left: 224, top: 716, width: 120.15, height: 88, angle: 35, ...CLOUD,
  };
  assertOffsetPreservingResize('rect@35', rect, {
    left: 224, top: 716, width: 120.15, height: 88,
  }, { angleDeg: 35 });
});

test('grab jump: a SCALED cloud (Fabric scaleX/scaleY) tracks 1:1 on its rendered box', () => {
  const rect = {
    type: 'rect', left: 224, top: 716, width: 80, height: 60, scaleX: 1.6, scaleY: 0.7, ...CLOUD,
  };
  // The hook feeds rawWidth = obj.width and scaleX = obj.scaleX; the rendered
  // box the grabbers hang off is width*scaleX. resizeGrabOffset takes both.
  const chrome = cloudSelectionChrome(rect);
  const bbox = { left: 224, top: 716, width: 80 * 1.6, height: 60 * 0.7 };
  const center = { x: bbox.left + bbox.width / 2, y: bbox.top + bbox.height / 2 };
  const anchors = anchorMapFor(bbox);
  for (const handleId of HANDLE_IDS) {
    const drawn = chrome.anchors[handleId];
    const offset = resizeGrabOffset({
      handleId,
      pointerX: drawn.x, pointerY: drawn.y,
      anchorX: anchors[handleId].x, anchorY: anchors[handleId].y,
      centerX: center.x, centerY: center.y,
      angleDeg: 0, width: 80, height: 60, scaleX: 1.6, scaleY: 0.7,
    });
    const atGrab = resizeStep({
      handleId, pointer: drawn, anchor: anchors[handleId], center,
      width: 80, height: 60, scaleX: 1.6, scaleY: 0.7, grabOffset: offset,
    });
    assert.ok(Math.abs(atGrab.width - bbox.width) < 1e-6, `scaled.${handleId} width jump`);
    assert.ok(Math.abs(atGrab.height - bbox.height) < 1e-6, `scaled.${handleId} height jump`);
  }
});

test('grab offset is zero for a handle that already sits on the box the math writes', () => {
  // Every non-cloud shape: the grabber is drawn on the bbox itself, so the
  // captured offset is 0 and the resize behaves exactly as it always did.
  const bbox = { left: 10, top: 20, width: 100, height: 60 };
  const anchors = anchorMapFor(bbox);
  const center = { x: 60, y: 50 };
  const boxHandlePoint = {
    tl: { x: 10, y: 20 }, mt: { x: 60, y: 20 }, tr: { x: 110, y: 20 }, mr: { x: 110, y: 50 },
    br: { x: 110, y: 80 }, mb: { x: 60, y: 80 }, bl: { x: 10, y: 80 }, ml: { x: 10, y: 50 },
  };
  for (const handleId of HANDLE_IDS) {
    const offset = resizeGrabOffset({
      handleId,
      pointerX: boxHandlePoint[handleId].x, pointerY: boxHandlePoint[handleId].y,
      anchorX: anchors[handleId].x, anchorY: anchors[handleId].y,
      centerX: center.x, centerY: center.y,
      width: bbox.width, height: bbox.height,
    });
    assert.ok(Math.abs(offset.dx) < 1e-9, `${handleId}.dx ${offset.dx}`);
    assert.ok(Math.abs(offset.dy) < 1e-9, `${handleId}.dy ${offset.dy}`);
  }
});

test('grab offset never leaks onto an axis its handle does not drive (no skew)', () => {
  const bbox = { left: 224, top: 716, width: 120.15, height: 88 };
  const anchors = anchorMapFor(bbox);
  const center = { x: bbox.left + bbox.width / 2, y: bbox.top + bbox.height / 2 };
  for (const handleId of ['mt', 'mb']) {
    const offset = resizeGrabOffset({
      handleId, pointerX: 999, pointerY: 999,
      anchorX: anchors[handleId].x, anchorY: anchors[handleId].y,
      centerX: center.x, centerY: center.y, width: bbox.width, height: bbox.height,
    });
    assert.equal(offset.dx, 0, `${handleId} must not touch the X axis`);
  }
  for (const handleId of ['ml', 'mr']) {
    const offset = resizeGrabOffset({
      handleId, pointerX: 999, pointerY: 999,
      anchorX: anchors[handleId].x, anchorY: anchors[handleId].y,
      centerX: center.x, centerY: center.y, width: bbox.width, height: bbox.height,
    });
    assert.equal(offset.dy, 0, `${handleId} must not touch the Y axis`);
  }
});

test('rotation grab offset: normalized to (-180, 180] and zero when the handle is already on angle', () => {
  assert.equal(rotationGrabOffsetDeg({ pointerAngleDeg: 30, originalAngleDeg: 30 }), 0);
  assert.equal(rotationGrabOffsetDeg({ pointerAngleDeg: 35, originalAngleDeg: 30 }), 5);
  assert.equal(rotationGrabOffsetDeg({ pointerAngleDeg: 5, originalAngleDeg: 355 }), 10);
  assert.equal(rotationGrabOffsetDeg({ pointerAngleDeg: 355, originalAngleDeg: 5 }), -10);
});

test('the interaction hook actually subtracts the grab offsets it captures', () => {
  const hook = read('src/hooks/useSVGInteraction.js');
  assert.match(hook, /import \{ resizeGrabOffset, rotationGrabOffsetDeg \} from '\.\.\/utils\/offsetPreservingResize\.js'/);
  // Captured once at pointerdown, for clouds (whose grabbers are off the box).
  assert.match(hook, /resizeGrabOffset:\s*resizeGrabOffsetValue/);
  assert.match(hook, /rotateGrabOffsetDeg:\s*rotateGrabOffsetValue/);
  // Subtracted on both axes of every move.
  assert.match(hook, /const signedLocalDx = \(isLeftHandle \? -ptrDxLocal : ptrDxLocal\) - grabOffsetDx;/);
  assert.match(hook, /const signedLocalDy = \(isTopHandle \? -ptrDyLocal : ptrDyLocal\) - grabOffsetDy;/);
  assert.match(hook, /normalizeAngle\(radians\) - \(ds\.rotateGrabOffsetDeg \|\| 0\)/);
});

// ---------------------------------------------------------------------------
// (4) POLYGON / POLYLINE CLOUD CHROME
// ---------------------------------------------------------------------------

test('poly cloud single click: vertex dots PLUS the padded dashed frame, and no resize grabbers', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const branch = layer.slice(layer.indexOf('if (isPolyShape && !polyInBboxMode) {'));
  const branchBody = branch.slice(0, branch.indexOf('\n        }\n'));
  assert.ok(branchBody.length > 0, 'poly single-click branch found');
  assert.match(branchBody, /const polyCloudChrome = cloudSelectionChrome\(obj\);/,
    'the single-click branch must resolve the cloud frame');
  assert.match(branchBody, /data-cloud-frame="true"/,
    'a cloud must show its padded dashed frame on single click');
  assert.match(branchBody, /strokeDasharray="4,4"/, 'same dashed treatment as the bbox frame');
  // Vertex dots stay the ONLY grabbers in single-click mode.
  const handleAttrs = branchBody.match(/data-resize-handle=\{?`?([^}`"]*)/g) || [];
  for (const attr of handleAttrs) {
    assert.ok(attr.includes('vertex-'), `single click must only expose vertex handles, saw ${attr}`);
  }
});

test('poly cloud chrome: a plain (non-cloud) polygon resolves no frame, so its behaviour is unchanged', () => {
  const plain = {
    type: 'polygon', left: 100, top: 100, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 80, y: 10 }, { x: 60, y: 70 }],
    strokeWidth: 2, stroke: '#c42747', fill: 'transparent',
  };
  assert.equal(cloudSelectionChrome(plain), null);
});

test('poly cloud chrome: the frame rotates about the cloud\'s own pivot', () => {
  const poly = {
    type: 'polygon', left: 100, top: 100, pathOffset: { x: 0, y: 0 }, angle: 40,
    points: [{ x: 0, y: 0 }, { x: 200, y: 20 }, { x: 180, y: 150 }, { x: 40, y: 120 }],
    ...CLOUD,
  };
  const chrome = cloudSelectionChrome(poly);
  assert.equal(chrome.angle, 40);
  const flat = cloudSelectionChrome({ ...poly, angle: 0 });
  assert.deepEqual(chrome.rotationCenter, flat.rotationCenter);
  assert.deepEqual(chrome.frame, flat.frame, 'the frame is stored unrotated; the overlay rotates it');
});

// ---------------------------------------------------------------------------
// (5) FRAME PAD — measured from the ink's OUTER edge
// ---------------------------------------------------------------------------

test('frame pad clears the PAINTED crown by a full stroke width, not by half of one', () => {
  assert.equal(CLOUD_FRAME_PAD_STROKE_RATIO, 1.5,
    'hull is the crown CENTRELINE: sw/2 reaches the painted edge, +sw is the clear gap');
  for (const strokeWidth of [1, 2.5, 6]) {
    const chrome = cloudSelectionChrome({
      type: 'rect', left: 224, top: 716, width: 120, height: 90, ...CLOUD, strokeWidth,
    });
    // pad - sw/2 is the air between the painted edge and the dashes.
    assert.ok(Math.abs((chrome.pad - strokeWidth / 2) - strokeWidth) < 1e-9,
      `sw ${strokeWidth}: clear gap ${(chrome.pad - strokeWidth / 2).toFixed(3)}`);
  }
});

// ---------------------------------------------------------------------------
// (6) ENTER FINISHES THE DRAFT WHEREVER FOCUS SITS
// ---------------------------------------------------------------------------

test('draft keys: only a real typing surface keeps Enter / Escape', () => {
  // The cases that used to swallow Enter: a focused toolbar button, and any
  // non-text input (checkbox, radio, range, colour swatch).
  assert.equal(isTextEntryTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'button' }), false);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'radio' }), false);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'range' }), false);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'color' }), false);
  assert.equal(isTextEntryTarget({ tagName: 'DIV' }), false);
  assert.equal(isTextEntryTarget({ tagName: 'svg' }), false);
  assert.equal(isTextEntryTarget(null), false);
  // ...and the cases that must still win, so typing is never hijacked.
  assert.equal(isTextEntryTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT', type: 'number' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'INPUT' }), true, 'no type = type="text"');
  assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true);
});

test('draft keys: the listener is window-capture and uses the shared typing test', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const start = layer.indexOf('if (!polyDraftActive) return undefined;\n    const onKeyDown');
  assert.ok(start > 0, 'poly draft keydown effect found');
  const effect = layer.slice(start, start + 900);
  assert.match(effect, /if \(isTextEntryTarget\(e\.target\)\) return;/,
    'the guard must be the shared typing test, not a blanket tagName === INPUT bail');
  assert.match(effect, /e\.key === 'Enter'[\s\S]*commitPolyDraft\('finish'\)/);
  assert.match(effect, /e\.key === 'Escape'[\s\S]*cancelPolyDraft\(\)/);
  assert.match(effect, /window\.addEventListener\('keydown', onKeyDown, true\)/,
    'capture phase on window so nothing downstream can swallow the key first');
});

test('draft keys: arming Polygon / Polyline hands focus back to the page', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /import \{ releaseFocusForDraftTool \} from '\.\/utils\/draftKeyboardTarget\.js'/);
  assert.match(
    viewer,
    /if \(t\.id === 'polygon' \|\| t\.id === 'polyline'\) \{\s*releaseFocusForDraftTool\(e\.currentTarget\);/,
    'the shape sub-toolbar must blur itself when it arms a click-to-place tool',
  );
});
