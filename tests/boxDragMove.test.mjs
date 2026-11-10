// Drag inside a picked mark to move it; a finger gets a move grip (Nightly
// 'box-drag-move', Drawboard PDF Pro trial audit 2026-11-10, R3-F #1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BOX_DRAG_MOVE_FLAG,
  BOX_MOVE_GRIP_GAP_PX,
  BOX_MOVE_GRIP_PX,
  boxDragMoveKind,
  boxMoveGripGlyphPath,
  boxMoveGripPlacement,
} from '../src/utils/boxDragMove.js';
import { classifySelectionGrabTarget } from '../src/utils/toolPressRouting.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('the flag is a beta flag, seeded off in its migration', () => {
  assert.equal(BOX_DRAG_MOVE_FLAG, 'box-drag-move');
  assert.deepEqual({ ...FEATURE_FLAGS['box-drag-move'] }, { label: 'Drag inside a picked mark to move it', stage: 'beta' });
  assert.equal(
    read('supabase/migrations/20261110129000_box_drag_move_flag.sql').trim(),
    "insert into public.feature_flags (key, mode, description) values ('box-drag-move','off','Drag inside a picked mark to move it') on conflict (key) do nothing;",
  );
});

test('a finger gets the grip; a mouse or pen gets the move zone', () => {
  assert.equal(boxDragMoveKind('touch'), 'grip');
  assert.equal(boxDragMoveKind('mouse'), 'zone');
  assert.equal(boxDragMoveKind('pen'), 'zone');
  assert.equal(boxDragMoveKind(undefined), 'zone');
});

test('the grip sits centred just under the box, sized in screen pixels', () => {
  const zone = { left: 100, top: 50, width: 80, height: 40, angle: 0, cx: 140, cy: 70 };
  const at100 = boxMoveGripPlacement(zone, { inverseScale: 1 });
  near(at100.cx, 140, 'centred');
  near(at100.r, BOX_MOVE_GRIP_PX / 2, 'radius');
  // Its top edge is the gap below the box's bottom (90).
  near(at100.cy - at100.r, 90 + BOX_MOVE_GRIP_GAP_PX, 'gap below the box');
  // Zoomed out to 50 % (2 page units per px) the grip keeps its screen size.
  const at50 = boxMoveGripPlacement(zone, { inverseScale: 2 });
  near(at50.r, BOX_MOVE_GRIP_PX, 'radius at 50 %');
  near(at50.cy - at50.r, 90 + BOX_MOVE_GRIP_GAP_PX * 2, 'gap at 50 %');
});

test('a turned box puts the grip under its lowest corner', () => {
  // 80 x 40 turned 90 degrees: it now reaches 40 below its centre.
  const zone = { left: 100, top: 50, width: 80, height: 40, angle: 90, cx: 140, cy: 70 };
  const grip = boxMoveGripPlacement(zone, { inverseScale: 1 });
  near(grip.cy - grip.r, 70 + 40 + BOX_MOVE_GRIP_GAP_PX, 'below the turned box');
  // 45 degrees: half of (80 + 40) / sqrt(2).
  const tilted = boxMoveGripPlacement({ ...zone, angle: 45 }, { inverseScale: 1 });
  near(tilted.cy - tilted.r, 70 + (120 / Math.SQRT2) / 2 + BOX_MOVE_GRIP_GAP_PX, 'below the tilted box');
});

test('no zone, no grip; a bad scale falls back to 1', () => {
  assert.equal(boxMoveGripPlacement(null), null);
  assert.equal(boxMoveGripPlacement({ left: 'x', top: 0, width: 1, height: 1 }), null);
  const grip = boxMoveGripPlacement({ left: 0, top: 0, width: 10, height: 10 }, { inverseScale: -3 });
  near(grip.cx, 5, 'centre from the box when cx is missing');
  near(grip.r, BOX_MOVE_GRIP_PX / 2, 'scale 1');
});

test('the glyph is four arrows around the centre, inside the disc', () => {
  const d = boxMoveGripGlyphPath(50, 50, 18);
  assert.equal((d.match(/M /g) || []).length, 6);
  const nums = d.replace(/[ML]/g, ' ').trim().split(/\s+/).map(Number);
  for (const n of nums) assert.ok(n >= 50 - 18 && n <= 50 + 18, `inside the disc: ${n}`);
});

test('the zone and the grip count as the selection for the grab hand-off', () => {
  const el = (attrs) => ({
    attrs,
    getAttribute(name) { return this.attrs[name] ?? null; },
    closest(selector) {
      const names = selector.split(',').map((part) => part.trim().replace(/^\[|\]$/g, '').split('=')[0]);
      return names.some((name) => name in this.attrs) ? this : null;
    },
  });
  const svg = { contains: () => true };
  assert.equal(classifySelectionGrabTarget(el({ 'data-box-drag-move-zone': 'true' }), svg, {}).key, 'handle');
  assert.equal(classifySelectionGrabTarget(el({ 'data-box-move-grip': 'true' }), svg, {}).key, 'handle');
  assert.equal(classifySelectionGrabTarget(el({}), svg, {}), null);
});

test('the layer gates both behind the flag and draws the zone under the marks', () => {
  const src = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(src, /const boxDragMoveOn = \(\) => isFeatureOn\(BOX_DRAG_MOVE_FLAG\);/);
  assert.match(src, /if \(!boxDragMoveOn\(\) \|\| modifierMoveActive/);
  // The zone comes before the marks group, so a press on any mark wins.
  const zoneAt = src.indexOf('data-box-drag-move-zone="true"');
  const marksAt = src.indexOf('<g data-page-clip="marks"');
  assert.ok(zoneAt > 0 && zoneAt < marksAt, 'the zone is drawn under the marks');
  // The Cmd / Ctrl zone still draws only while its key is held.
  assert.match(src, /\{modifierMoveZone && modifierMoveActive && \(/);
  // No native tooltip on the grip.
  const grip = src.slice(src.indexOf('data-box-move-grip="true"'), src.indexOf('data-box-move-grip="true"') + 400);
  assert.doesNotMatch(grip, /title=/);
});
