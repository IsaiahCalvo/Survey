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
//
// ROUND 4, 2026-09-10 - four more defects measured live on
// claude/cloud-round3-integration, and the contract changes they force:
// (7) RELEASE JUMP. The live resize preview was exact but the pointerup commit
//     rounded scaleX/scaleY to 2 decimals (round 3's
//     annotationCommitRounding). A scale ULP is rawWidth/100 PAGE UNITS, so
//     the committed box missed by up to rawSize*0.005 and the shape visibly
//     nudged on release (~1.35 CSS px at 195%). Scales now round on the 1e-6
//     grid; lengths, positions and angles keep the 0.01 grid. CONTRACT: the
//     committed box equals the preview to within 0.01 page units.
// (8) TINY POLYLINE GRABBERS. A 2-point polyline cloud's frame is 157 x 20
//     page units and the edge PILLS need cornerR*2 + pillH + gaps = 47 units,
//     so the adaptive tier culled all four and the cloud's short axis could
//     not be resized at all. CONTRACT CHANGE: a cloud in bbox mode ALWAYS
//     exposes all eight grabbers - when the pills do not fit, the edge
//     grabbers render as DOTS the size of the corner dots on the frame's edge
//     midpoints, driving the same resize math, pushed outward along the frame
//     normal if a dot would otherwise overlap its neighbours. This REPLACES
//     round 3's "the FRAME decides, not always eight" note below, which
//     accepted four corners on a thin frame; the owner ruled that a grabber
//     the user cannot reach is not an acceptable answer.
// (9) DRAFT KEYS IN A NUMERIC FIELD. With a polygon/polyline draft in flight,
//     focusing "Cloud bump size" or "Width" made Enter and Escape do nothing:
//     both are <input type="text" inputmode="numeric">, which the typing test
//     (correctly) calls a text-entry surface. CONTRACT: a numeric CHROME field
//     yields both keys to a draft in flight - Enter commits its value (the
//     handler blurs it, and these fields commit on blur) and finishes the
//     draft, Escape blurs then cancels. Genuine text-editing surfaces keep
//     their own keys.
// (10) GLOW OVER TRANSLUCENT INK. The glow was a plain underlay, so an opaque
//     stroke kept its colour but a translucent one (the app's rgba .5 cloud
//     stroke) turned purple when selected. Verified in Drawboard PDF on
//     2026-09-10: its glow is a plain unmasked underlay too and the same cloud
//     at 50% stroke opacity reads purple there, so this is deliberately BETTER
//     than Drawboard rather than parity with it. CONTRACT: the ink band (the
//     outline stroked at the ink width) is knocked OUT of the glow, so the
//     glow is a ring on either side of the stroke and never sits under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLOUD_FRAME_PAD_STROKE_RATIO,
  cloudOutlineBounds,
  cloudSelectionChrome,
  resolveCloudAnnotationGeometry,
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
import {
  DRAFT_KEY_YIELD_ATTR,
  draftOwnsKeyboard,
  isTextEntryTarget,
  yieldsDraftKeys,
} from '../src/utils/draftKeyboardTarget.js';
import { round2, roundScale } from '../src/utils/annotationCommitRounding.js';
import { buildCloudGlowPaint } from '../src/utils/cloudSvgPaint.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');

const CLOUD = { strokeWidth: 2.5, stroke: '#c42747', fill: 'transparent', data: { pdfCloudIntensity: 2 } };
const HANDLE_IDS = ['tl', 'mt', 'tr', 'mr', 'br', 'mb', 'bl', 'ml'];

const resolveCloudGeometryFixture = () => resolveCloudAnnotationGeometry({
  type: 'rect', left: 100, top: 100, width: 300, height: 200, ...CLOUD,
});

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
  const specFor = (frame) => getAdaptiveSelectionHandleSpec({
    bboxWidth: frame.width, bboxHeight: frame.height, inverseScale: 1, padding: 0,
    alwaysAllHandles: true,
  });

  // Dead flat: the inner box has height 0, which collapsed the whole set to a
  // single 'br' grabber — the live symptom. Its crown frame is a real 20-unit
  // band.
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

  // CONTRACT CHANGE 2026-09-10 (defect 8). Round 3 accepted four corners here
  // and documented it as "the FRAME decides, not always eight" — but a 157x20
  // frame with corners only cannot be resized on its short axis at all, which
  // is the defect the owner measured. All eight now, with the edge grabbers
  // demoted from 28-unit pills to corner-sized dots.
  const spec = specFor(flat.frame);
  assert.deepEqual(spec.resizeHandles, ALL_RESIZE_HANDLES,
    'a cloud in bbox mode always exposes all eight grabbers');
  assert.equal(spec.edgeHandleShape, 'dot',
    'a 20-unit-tall frame cannot hold a 28-unit pill: the edge grabbers become dots');
  assert.equal(spec.tier, 'corners',
    'the tier still reports what FITS; edgeHandleShape reports what is drawn');

  // The dots on the short axis have to step outward to clear the corners.
  assert.ok(spec.edgeDotOutset.x > 0, `ml/mr outset ${spec.edgeDotOutset.x}`);
  assert.equal(spec.edgeDotOutset.y, 0, 'the long axis has room; mt/mb stay on the frame');

  const sloped = cloudSelectionChrome({
    type: 'polyline', left: 100, top: 100, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 150, y: 70 }], ...CLOUD,
  });
  const slopedSpec = specFor(sloped.frame);
  assert.deepEqual(slopedSpec.resizeHandles, ALL_RESIZE_HANDLES);
  assert.equal(slopedSpec.edgeHandleShape, 'pill',
    'as soon as the frame has room, the real pills come back');
  assert.deepEqual(slopedSpec.edgeDotOutset, { x: 0, y: 0 });
});

test('cloud grabbers: eight dots on the smallest frames, and no two of them ever overlap', () => {
  // The drawn position of each grabber, mirroring SVGSelectionOverlay's
  // edgeHandlePos(): corners stay on the frame, edge dots step out along their
  // own normal by the spec's clearance.
  const drawnPoints = (frame, spec, metrics) => {
    const right = frame.left + frame.width;
    const bottom = frame.top + frame.height;
    const midX = frame.left + frame.width / 2;
    const midY = frame.top + frame.height / 2;
    const out = spec.edgeHandleShape === 'dot' ? spec.edgeDotOutset : { x: 0, y: 0 };
    return {
      tl: { x: frame.left, y: frame.top },
      tr: { x: right, y: frame.top },
      bl: { x: frame.left, y: bottom },
      br: { x: right, y: bottom },
      mt: { x: midX, y: frame.top - out.y },
      mb: { x: midX, y: bottom + out.y },
      ml: { x: frame.left - out.x, y: midY },
      mr: { x: right + out.x, y: midY },
    };
  };

  // Every cloud shape a user can draw, at its most cramped, plus zoom levels
  // where the screen-constant grabbers eat the most page space.
  const fixtures = [
    ['polyline-2pt-flat', { type: 'polyline', left: 100, top: 100, pathOffset: { x: 0, y: 0 }, points: [{ x: 0, y: 0 }, { x: 150, y: 0 }], ...CLOUD }],
    ['polyline-2pt-short', { type: 'polyline', left: 100, top: 100, pathOffset: { x: 0, y: 0 }, points: [{ x: 0, y: 0 }, { x: 40, y: 0 }], ...CLOUD }],
    ['rect-sliver', { type: 'rect', left: 100, top: 100, width: 160, height: 1, ...CLOUD }],
    ['rect-tiny', { type: 'rect', left: 100, top: 100, width: 6, height: 6, ...CLOUD }],
    ['ellipse-thin', { type: 'ellipse', left: 100, top: 100, rx: 90, ry: 2, ...CLOUD }],
    ['polygon-tiny', { type: 'polygon', left: 100, top: 100, pathOffset: { x: 0, y: 0 }, points: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 18 }, { x: 0, y: 18 }], ...CLOUD }],
  ];

  for (const [label, obj] of fixtures) {
    const chrome = cloudSelectionChrome(obj);
    assert.ok(chrome, `${label}: chrome resolves`);
    for (const inverseScale of [1, 0.5128, 2, 4]) {
      const spec = getAdaptiveSelectionHandleSpec({
        bboxWidth: chrome.frame.width,
        bboxHeight: chrome.frame.height,
        inverseScale,
        padding: 0,
        alwaysAllHandles: true,
      });
      assert.deepEqual(spec.resizeHandles, ALL_RESIZE_HANDLES,
        `${label}@${inverseScale}: all eight grabbers, always`);
      const metrics = { r: 5.5 * Math.sqrt(inverseScale), gap: 4 * Math.sqrt(inverseScale) };
      const points = drawnPoints(chrome.frame, spec, metrics);
      const ids = Object.keys(points);
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const a = points[ids[i]];
          const b = points[ids[j]];
          const gap = Math.hypot(a.x - b.x, a.y - b.y);
          // Two dots of radius r need 2r between centres to stop touching.
          // The corner pair on a genuinely tiny frame is the one case the
          // frame itself owns (a cloud frame is never smaller than a crown
          // depth), so only EDGE dots carry the clearance guarantee.
          const isEdgePair = ids[i].startsWith('m') || ids[j].startsWith('m');
          if (spec.edgeHandleShape === 'dot' && isEdgePair) {
            assert.ok(gap >= metrics.r * 2 + metrics.gap - 1e-9,
              `${label}@${inverseScale}: ${ids[i]}/${ids[j]} only ${gap.toFixed(2)} apart, need ${(metrics.r * 2 + metrics.gap).toFixed(2)}`);
          } else {
            assert.ok(gap > 0, `${label}@${inverseScale}: ${ids[i]}/${ids[j]} share a point`);
          }
        }
      }
      // Screen-constant: halve the page-per-screen ratio and the outset
      // shrinks with the dots rather than staying a fixed page distance.
      if (spec.edgeHandleShape === 'dot' && spec.edgeDotOutset.x > 0) {
        const denser = getAdaptiveSelectionHandleSpec({
          bboxWidth: chrome.frame.width,
          bboxHeight: chrome.frame.height,
          inverseScale: inverseScale / 4,
          padding: 0,
          alwaysAllHandles: true,
        });
        assert.ok(denser.edgeDotOutset.x <= spec.edgeDotOutset.x + 1e-9,
          `${label}: zooming IN must not push the dots further out in page units`);
      }
    }
  }
});

test('cloud grabbers: an ordinary (non-cloud) selection still culls handles it cannot fit', () => {
  // The dot fallback is opt-in. Without the flag a small mark behaves exactly
  // as it always has — this is the regression guard for every other shape.
  const spec = getAdaptiveSelectionHandleSpec({
    bboxWidth: 157, bboxHeight: 20, inverseScale: 1, padding: 2,
  });
  assert.deepEqual(spec.resizeHandles, ['tl', 'tr', 'bl', 'br']);
  assert.equal(spec.edgeHandleShape, 'pill');
  assert.deepEqual(spec.edgeDotOutset, { x: 0, y: 0 });
});

test('cloud grabbers: the overlay draws dot edge grabbers and the layer asks for them on clouds', () => {
  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  assert.match(overlay, /alwaysAllHandles:\s*alwaysShowResizeHandles/,
    'the overlay must forward the always-eight request to the spec');
  assert.match(overlay, /const edgeHandlesAreDots = handleSpec\.edgeHandleShape === 'dot';/);
  // A DOT IS A <rect>, NOT A <circle> — see the next test for why.
  assert.equal((overlay.match(/data-edge-handle-shape=/g) || []).length, 2,
    'both edge pairs (mt/mb and ml/mr) get the dot fallback');
  assert.match(overlay, /const edgeHandleGeometry = \(pos, axis, asPill = false\) => \{/);
  // The dot drives the SAME resize math as the pill it replaces.
  assert.match(overlay, /const pressHandler = \(id\) => \(delegateHandlePress \? undefined : \(e\) => \{\s*e\.stopPropagation\(\);\s*onHandleDrag\?\.\(e, id\);/);
  const dotBlocks = overlay.split('data-edge-handle-shape=').slice(1);
  for (const block of dotBlocks) {
    // Owner Test 45 (2026-10-06): the entry point is pressHandler(id), which
    // calls onHandleDrag(e, id) - or, for a callout box's grabbers only
    // (delegateHandlePress), lets the press reach the callout's own handler.
    assert.match(block.slice(0, 1200), /onPointerDown=\{(horizontalResizeOnly \? undefined : )?pressHandler\(id\)\}/,
      'a dot grabber must call the same handle-drag entry point');
  }
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /alwaysShowResizeHandles=\{!!cloudChrome\}/,
    'clouds — and only clouds — ask for the always-eight behaviour');
});

test('cloud grabbers: an edge grabber keeps ONE element type, so a drag survives dot -> pill', () => {
  // MEASURED LIVE 2026-09-10, and the reason this is pinned. The first cut of
  // the dot fallback rendered a <circle> in dot mode and a <rect> in pill mode
  // under the same key. useSVGInteraction calls e.target.setPointerCapture at
  // pointerdown, so when a drag on a 2-point polyline cloud's 'mb' dot grew the
  // frame past the pill threshold, React unmounted the captured <circle>, the
  // capture died with it, and the resize stopped mid-gesture and committed
  // nothing (verified: the grabbed node came back isConnected === false).
  //
  // A dot is therefore a <rect> with rx = half its side, which renders as a
  // circle: crossing the threshold is an attribute update, not a remount.
  const overlay = read('src/components/SVGSelectionOverlay.jsx');
  const edgeBlockStart = overlay.indexOf("['mt', 'mb'].filter");
  const edgeBlockEnd = overlay.indexOf('{/* Rotation handle (mtr) */}');
  assert.ok(edgeBlockStart > 0 && edgeBlockEnd > edgeBlockStart, 'edge handle blocks found');
  const edgeBlocks = overlay.slice(edgeBlockStart, edgeBlockEnd);
  assert.ok(!/<circle/.test(edgeBlocks),
    'no edge grabber may render a <circle> — swapping element type kills pointer capture mid-drag');
  // ...and the dot really is round: a square rect with rx = half the side.
  assert.match(overlay, /const side = handleMetrics\.cornerR \* 2;/);
  assert.match(overlay, /rx: handleMetrics\.cornerR,/);
  // Corner grabbers are still circles; they never change shape, so they are safe.
  assert.match(overlay, /<circle\s+key=\{`corner-\$\{id\}`\}/);
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
    (layer.match(/data-cloud-glow="true"/g) || []).length, 1,
    'exactly one glow emitter — a second copy in the hit group would paint over the ink again',
  );
});

// ---------------------------------------------------------------------------
// (10) GLOW RING — the ink band is knocked OUT of the glow
// ---------------------------------------------------------------------------

test('cloud glow: the ink band is masked OUT, so a translucent stroke keeps its own colour', () => {
  // CONTRACT CHANGE 2026-09-10 (defect 10). Round 3 pinned "glow under the
  // ink", which is what Drawboard PDF does and is enough while the ink is
  // opaque. It is NOT enough at the app's translucent cloud stroke: measured
  // live, an rgba(.5) red cloud read purple the moment it was selected because
  // the 0.666-opacity blue showed through the crowns. (Reproduced in Drawboard
  // itself at 50% stroke opacity on 2026-09-10, so this is an improvement on
  // the reference, not parity with it.) The glow keeps its underlay position —
  // the paint-order test above still stands — and additionally knocks the ink
  // band out of itself, exactly the way the FILL knockout works.
  const geometry = resolveCloudGeometryFixture();
  const glow = buildCloudGlowPaint(geometry, { maskId: 'glow-1' });
  assert.ok(glow, 'glow paint resolves');
  assert.equal(glow.transform, geometry.transform, 'same local frame as the ink');
  assert.ok(Math.abs(glow.glowWidth - glow.inkWidth * 2.85) < 1e-9,
    'the glow is still 2.85x the ink (Drawboard proportions)');
  assert.equal(glow.inkWidth, 2.5, 'the knockout is stroked at the INK width, not the glow width');
  assert.ok(glow.mask, 'a knockout mask is emitted');
  // The mask region has to cover the whole glow band, which reaches half a
  // glow width past the crown hull; anything smaller would clip the ring.
  const hull = cloudOutlineBounds(geometry);
  assert.ok(glow.mask.x <= hull.left - glow.glowWidth / 2, 'mask clears the glow band on the left');
  assert.ok(glow.mask.y <= hull.top - glow.glowWidth / 2, 'mask clears the glow band on the top');
  assert.ok(glow.mask.x + glow.mask.width >= hull.left + hull.width + glow.glowWidth / 2);
  assert.ok(glow.mask.y + glow.mask.height >= hull.top + hull.height + glow.glowWidth / 2);
  // A cloud with no stroke width still gets a reference band to knock out.
  const bare = buildCloudGlowPaint({ ...geometry, strokeWidth: 0 }, { maskId: 'g' });
  assert.equal(bare.inkWidth, 1);
});

test('cloud glow: the layer paints the ring through the mask, knocked out at the ink width', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(layer, /const cloudGlowPaint = cloudGlowVisible/,
    'the glow resolves through the shared paint model');
  const start = layer.indexOf('{cloudGlowPaint && (');
  assert.ok(start > 0, 'glow underlay found');
  const block = layer.slice(start, start + 2200);
  assert.match(block, /maskUnits="userSpaceOnUse"/, 'the knockout is in the cloud local frame');
  assert.match(block, /data-cloud-glow-knockout="true"/);
  assert.match(block, /strokeWidth=\{cloudGlowPaint\.inkWidth\}/,
    'the knockout is the ink band, so the glow never sits under the stroke');
  assert.match(block, /strokeWidth=\{cloudGlowPaint\.glowWidth\}/);
  assert.match(block, /strokeOpacity=\{CLOUD_HOVER_GLOW_OPACITY\}/);
  assert.match(block, /mask=\{cloudGlowPaint\.mask \? `url\(#\$\{cloudGlowPaint\.mask\.id\}\)` : undefined\}/);
  // Round caps/joins on BOTH bands, or the knockout would miss the crown tails.
  assert.equal((block.match(/strokeLinecap="round"/g) || []).length, 2);
  assert.equal((block.match(/strokeLinejoin="round"/g) || []).length, 2);
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
  return {
    width: width * Math.abs(nsx),
    height: height * Math.abs(nsy),
    scaleX: Math.abs(nsx),
    scaleY: Math.abs(nsy),
  };
};

// What pointerup actually STORES, and therefore what the user sees the instant
// they let go: useSVGInteraction writes `obj.scaleX = Math.abs(newScaleX)`
// (obj.width is untouched by a resize) and then hands the payload to
// roundCommittedAnnotationGeometry. The rendered box is the product.
const commitBox = (rawWidth, rawHeight, preview, { legacyScaleRounding = false } = {}) => {
  const roundScaleValue = legacyScaleRounding ? round2 : roundScale;
  return {
    width: round2(rawWidth) * roundScaleValue(preview.scaleX),
    height: round2(rawHeight) * roundScaleValue(preview.scaleY),
  };
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

// ---------------------------------------------------------------------------
// (7) RELEASE JUMP — the commit must land ON the preview
// ---------------------------------------------------------------------------

// Drag a grabber by `move` page units along its own growth direction, then
// COMMIT, and compare the stored box with the preview the user was watching.
const assertNoReleaseJump = (label, obj, bbox, { angleDeg = 0, move = 25 } = {}) => {
  const chrome = cloudSelectionChrome(obj);
  assert.ok(chrome, `${label}: chrome resolves`);
  const center = { x: bbox.left + bbox.width / 2, y: bbox.top + bbox.height / 2 };
  const anchors = anchorMapFor(bbox);
  let sawOldJump = false;
  for (const handleId of HANDLE_IDS) {
    const affectsX = !['mt', 'mb'].includes(handleId);
    const affectsY = !['ml', 'mr'].includes(handleId);
    const isLeft = ['tl', 'ml', 'bl'].includes(handleId);
    const isTop = ['tl', 'mt', 'tr'].includes(handleId);
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
      pointerX: drawn.x, pointerY: drawn.y,
      anchorX: anchors[handleId].x, anchorY: anchors[handleId].y,
      centerX: center.x, centerY: center.y,
    });
    const dirX = affectsX ? (isLeft ? -1 : 1) : 0;
    const dirY = affectsY ? (isTop ? -1 : 1) : 0;
    const world = rotatePoint(dirX * move, dirY * move, 0, 0, angleDeg);
    const preview = resizeStep({
      ...common, pointer: { x: drawn.x + world.x, y: drawn.y + world.y }, grabOffset: offset,
    });
    const wantW = bbox.width + (affectsX ? move : 0);
    const wantH = bbox.height + (affectsY ? move : 0);
    // The preview itself is exact — that was never the defect.
    assert.ok(Math.abs(preview.width - wantW) < 1e-6, `${label}.${handleId}: preview width`);
    assert.ok(Math.abs(preview.height - wantH) < 1e-6, `${label}.${handleId}: preview height`);

    const committed = commitBox(bbox.width, bbox.height, preview);
    assert.ok(Math.abs(committed.width - wantW) <= 0.01,
      `${label}.${handleId}: committed width ${committed.width.toFixed(4)} jumped ${(committed.width - wantW).toFixed(4)} off the preview`);
    assert.ok(Math.abs(committed.height - wantH) <= 0.01,
      `${label}.${handleId}: committed height ${committed.height.toFixed(4)} jumped ${(committed.height - wantH).toFixed(4)} off the preview`);

    // ...and the rule it replaces really did move the shape.
    const legacy = commitBox(bbox.width, bbox.height, preview, { legacyScaleRounding: true });
    if (Math.abs(legacy.width - wantW) > 0.01 || Math.abs(legacy.height - wantH) > 0.01) sawOldJump = true;
  }
  assert.ok(sawOldJump,
    `${label}: fixture must actually exhibit the 2-decimal scale jump it is guarding against`);
};

for (const [label, obj, bbox] of [
  ['rect', { type: 'rect', left: 224, top: 716, width: 120.15, height: 88, ...CLOUD },
    { left: 224, top: 716, width: 120.15, height: 88 }],
  ['ellipse', { type: 'ellipse', left: 300, top: 200, rx: 90, ry: 55, ...CLOUD },
    { left: 300, top: 200, width: 180, height: 110 }],
  ['polygon', {
    type: 'polygon', left: 100, top: 100, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 203, y: 21 }, { x: 178, y: 151 }, { x: 41, y: 119 }], ...CLOUD,
  }, { left: 100, top: 100, width: 203, height: 151 }],
  ['polyline', {
    type: 'polyline', left: 100, top: 100, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 157, y: 63 }], ...CLOUD,
  }, { left: 100, top: 100, width: 157, height: 63 }],
]) {
  test(`release jump: a ${label} cloud commits exactly where the preview was — upright`, () => {
    assertNoReleaseJump(label, obj, bbox);
  });

  test(`release jump: a ${label} cloud commits exactly where the preview was — rotated 30 deg`, () => {
    assertNoReleaseJump(`${label}@30`, { ...obj, angle: 30 }, bbox, { angleDeg: 30 });
  });
}

test('release jump: the commit rounds LENGTHS on 0.01 and SCALES on 1e-6, not the other way round', () => {
  const source = read('src/utils/annotationCommitRounding.js');
  assert.match(source, /const SCALAR_GEOMETRY_KEYS = \[[^\]]*\]/);
  const scalarKeys = source.slice(source.indexOf('const SCALAR_GEOMETRY_KEYS'), source.indexOf('const SCALE_GEOMETRY_KEYS'));
  assert.ok(!/scaleX/.test(scalarKeys) && !/scaleY/.test(scalarKeys),
    'scaleX / scaleY must NOT be on the 2-decimal list — a scale ULP is rawSize/100 page units');
  assert.match(source, /const SCALE_GEOMETRY_KEYS = \['scaleX', 'scaleY'\];/);
  assert.match(source, /export const roundScale = \(value\) => Number\(\(Number\(value\) \|\| 0\)\.toFixed\(6\)\);/);
  // The header has to say why, or the next pass "tidies" the scales back on.
  assert.match(source, /SCALE IS THE EXCEPTION/);
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

test('draft keys: a NUMERIC CHROME FIELD yields Enter / Escape to a draft in flight', () => {
  // CONTRACT CHANGE 2026-09-10 (defect 9). isTextEntryTarget is unchanged and
  // still correct on its own terms — "Cloud bump size" and "Width" ARE text
  // entry (<input type="text" inputmode="numeric">). What changed is who wins
  // while a click-to-place draft is in flight: those two fields opt OUT, so
  // Enter finishes the shape (after committing their value on blur) and
  // Escape cancels it, instead of both keys dying in a 36px number box.
  const bumpField = { tagName: 'INPUT', type: 'text', dataset: { draftYieldsKeys: 'true' } };
  assert.equal(isTextEntryTarget(bumpField), true, 'it is still a typing surface');
  assert.equal(yieldsDraftKeys(bumpField), true);
  assert.equal(draftOwnsKeyboard(bumpField), true, 'but the draft owns Enter / Escape');

  // Opt-in only: a genuine text-editing surface keeps its keys.
  assert.equal(draftOwnsKeyboard({ tagName: 'TEXTAREA' }), false, 'annotation text editor');
  assert.equal(draftOwnsKeyboard({ tagName: 'INPUT', type: 'search' }), false, 'search box');
  assert.equal(draftOwnsKeyboard({ tagName: 'INPUT', type: 'text' }), false, 'name field');
  assert.equal(draftOwnsKeyboard({ tagName: 'DIV', isContentEditable: true }), false);
  // ...and everything that was never a typing surface still loses them.
  assert.equal(draftOwnsKeyboard({ tagName: 'BUTTON' }), true);
  assert.equal(draftOwnsKeyboard(null), true);

  // A wrapper can opt a whole control in (closest()), not just the input.
  const wrapped = {
    tagName: 'INPUT',
    type: 'number',
    closest: (selector) => (selector === `[${DRAFT_KEY_YIELD_ATTR}]` ? { tagName: 'LABEL' } : null),
  };
  assert.equal(draftOwnsKeyboard(wrapped), true);
});

test('draft keys: both numeric chrome fields carry the opt-out attribute', () => {
  const sizeControl = read('src/components/AnnotationSizeControl.jsx');
  assert.match(sizeControl, /'data-draft-yields-keys': 'true'/,
    'the shared Width / Size field yields its keys to a draft');
  // ...and it still commits on blur, which is what makes "Enter commits the
  // field's value AND finishes the draft" true.
  assert.match(sizeControl, /onBlur: \(event\) => \{[\s\S]{0,160}commit\(event\.currentTarget\.value\);/);
  const shell = read('src/AppShell.jsx');
  const bumpAt = shell.indexOf('aria-label="Cloud bump size"');
  assert.ok(bumpAt > 0, 'bump field found');
  assert.match(shell.slice(bumpAt, bumpAt + 500), /data-draft-yields-keys="true"/);
});

test('draft keys: the listener is window-capture, yields only to real typing, and blurs the field', () => {
  const layer = read('src/components/SVGAnnotationLayer.jsx');
  const start = layer.indexOf('if (!polyDraftActive) return undefined;\n    const onKeyDown');
  assert.ok(start > 0, 'poly draft keydown effect found');
  const effect = layer.slice(start, start + 1200);
  assert.match(effect, /if \(!draftOwnsKeyboard\(e\.target\)\) return;/,
    'the guard must be the shared ownership test, not a blanket tagName === INPUT bail');
  assert.match(effect, /e\.key === 'Enter'[\s\S]*releaseFocusForDraftTool\(e\.target\)[\s\S]*commitPolyDraft\('finish'\)/,
    'Enter blurs the numeric field (committing its value) before finishing the draft');
  assert.match(effect, /e\.key === 'Escape'[\s\S]*releaseFocusForDraftTool\(e\.target\)[\s\S]*cancelPolyDraft\(\)/,
    'Escape blurs the field, then cancels the draft');
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
