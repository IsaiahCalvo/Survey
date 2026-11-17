// KAL-723 (Nightly 'flip-marks'): Drawboard's Flip > Horizontal / Vertical on
// the mark menu. The pick mirrors as one piece across the middle of its
// shared box; shapes, lines, ink and counters mirror, words stay readable;
// locked marks and text highlights stay; one save.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FLIP_MENU_ROWS,
  canFlipMark,
  flipCallout,
  flipCentre,
  flipMark,
  flipMarksOnPage,
} from '../src/utils/flipMarks.js';
import { getAnnotationWorldAABB } from '../src/utils/svgBoundingBox.js';
import { lineWorldPoints } from '../src/utils/groupResize.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('two rectangles swap sides across their shared middle', () => {
  const a = { type: 'rect', left: 0, top: 0, width: 20, height: 10, strokeWidth: 0, data: { id: 'a' } };
  const b = { type: 'rect', left: 80, top: 50, width: 20, height: 10, strokeWidth: 0, data: { id: 'b' } };
  const centre = flipCentre({ marks: [a, b] });
  near(centre.x, 50, 'centre x');
  near(centre.y, 30, 'centre y');
  const fa = flipMark(a, 'horizontal', centre);
  const fb = flipMark(b, 'horizontal', centre);
  near(fa.left, 80, 'a moves right');
  near(fa.top, 0, 'a keeps its height');
  near(fb.left, 0, 'b moves left');
  const va = flipMark(a, 'vertical', centre);
  near(va.left, 0, 'vertical keeps x');
  near(va.top, 50, 'vertical moves a down');
  assert.equal(a.left, 0, 'the original is untouched');
});

test('flipping twice puts every kind of mark back', () => {
  const marks = [
    { type: 'rect', left: 10, top: 20, width: 30, height: 15, angle: 30, data: { id: 'r' } },
    { type: 'polygon', left: 40, top: 40, width: 20, height: 20, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }], pathOffset: { x: 10, y: 10 }, data: { id: 'p' } },
    { type: 'line', left: 5, top: 5, width: 40, height: 20, x1: -20, y1: -10, x2: 20, y2: 10, data: { id: 'l' } },
    { type: 'circle', left: 60, top: 10, radius: 14, data: { id: 'c', type: 'counter', pointerAngle: 225 } },
    { type: 'textbox', left: 70, top: 70, width: 50, height: 20, text: 'Door', fontSize: 12, data: { id: 't' } },
  ];
  const centre = flipCentre({ marks });
  for (const axis of ['horizontal', 'vertical']) {
    for (const mark of marks) {
      const back = flipMark(flipMark(mark, axis, centre), axis, centre);
      near(back.left, mark.left, `${mark.data.id} ${axis} left`);
      near(back.top, mark.top, `${mark.data.id} ${axis} top`);
      if (mark.angle != null) near(back.angle, mark.angle, `${mark.data.id} angle`);
      if (mark.points) assert.deepEqual(back.points, mark.points);
      if (mark.data.pointerAngle != null) near(back.data.pointerAngle, mark.data.pointerAngle, 'pointer');
    }
  }
});

test('each kind mirrors the way a group resize through itself does', () => {
  const centre = { x: 100, y: 100 };
  // A tilted shape turns the other way.
  assert.equal(flipMark({ type: 'rect', left: 0, top: 0, width: 10, height: 10, angle: 30 }, 'horizontal', centre).angle, 330);
  // A points shape's points mirror in its own box.
  const tri = flipMark({ type: 'polygon', left: 0, top: 0, width: 20, height: 20, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }] }, 'horizontal', centre);
  assert.deepEqual(tri.points, [{ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 20, y: 20 }]);
  // A line's ends land at the mirrored spots.
  const line = { type: 'line', left: 10, top: 10, width: 40, height: 20, x1: -20, y1: -10, x2: 20, y2: 10 };
  const ends = lineWorldPoints(flipMark(line, 'horizontal', centre));
  near(ends.p1.x, 200 - 10, 'p1 x');
  near(ends.p2.x, 200 - 50, 'p2 x');
  near(ends.p1.y, 10, 'p1 y');
  // A counter's nub mirrors; its number stays upright.
  const pin = flipMark({ type: 'circle', left: 0, top: 0, radius: 10, data: { type: 'counter', pointerAngle: 0 } }, 'horizontal', centre);
  assert.equal(pin.data.pointerAngle, 180);
  near(pin.left, 180, 'pin left');
  // Text moves over at its own size and never reads backwards.
  const text = flipMark({ type: 'textbox', left: 0, top: 0, width: 50, height: 20, text: 'Hi' }, 'horizontal', centre);
  near(text.left, 150, 'text left');
  assert.equal(text.width, 50);
  assert.equal(text.scaleX, undefined);
  // Pen ink mirrors across the same line.
  const ink = { type: 'path', left: 0, top: 0, width: 20, height: 20, path: [['M', 0, 0], ['L', 20, 20]], pathOffset: { x: 10, y: 10 } };
  const before = getAnnotationWorldAABB(ink);
  const inkBox = getAnnotationWorldAABB(flipMark(ink, 'horizontal', centre));
  near(inkBox.left + inkBox.width / 2, 200 - (before.left + before.width / 2), 'ink middle');
  near(inkBox.width, before.width, 'ink width');
});

test('locked marks, text highlights and callout objects stay; the page keeps the rest', () => {
  assert.equal(canFlipMark({ type: 'rect', data: { type: 'text-markup' } }), false);
  assert.equal(canFlipMark({ type: 'rect', data: { type: 'callout' } }), false);
  assert.equal(canFlipMark({ type: 'rect', data: { lockedBy: 'user-1' } }), false);
  assert.equal(canFlipMark({ type: 'rect', data: {} }), true);
  const page = { objects: [
    { type: 'rect', left: 0, top: 0, width: 10, height: 10, data: { id: 'a' } },
    { type: 'rect', left: 90, top: 0, width: 10, height: 10, data: { id: 'b', type: 'text-markup' } },
    { type: 'rect', left: 300, top: 0, width: 10, height: 10, data: { id: 'c' } },
  ] };
  const result = flipMarksOnPage(page, [{ index: 0 }, { index: 1 }], 'horizontal', { x: 50, y: 5 });
  assert.deepEqual(result.indexes, [0]);
  near(result.page.objects[0].left, 90, 'a flipped');
  assert.equal(result.page.objects[1], page.objects[1]);
  assert.equal(result.page.objects[2], page.objects[2]);
  assert.equal(flipMarksOnPage(page, [{ index: 1 }], 'horizontal', { x: 50, y: 5 }), null);
});

test('a callout: the arrow mirrors, the box moves over at its own size', () => {
  const page = { width: 200, height: 100 };
  const callout = {
    id: 'c1',
    arrowTip: { x: 0.1, y: 0.5 },
    knee: { x: 0.2, y: 0.3 },
    textBoxPosition: { x: 0.25, y: 0.2 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.1,
    style: { fontSize: 12 },
  };
  const centre = flipCentre({ callouts: [callout], page });
  near(centre.x, 55, 'callout box middle');
  const patch = flipCallout(callout, 'horizontal', centre, page);
  near(patch.arrowTip.x, 0.45, 'tip');
  near(patch.knee.x, 0.35, 'knee');
  near(patch.textBoxPosition.x, 0.1, 'box');
  near(patch.textBoxPosition.y, 0.2, 'box y');
  assert.equal('textBoxWidth' in patch, false);
  assert.equal(flipCallout({ id: 'x' }, 'horizontal', centre, page), null);
});

test('wiring: Nightly flag, Flip submenu on every mark menu, one save', () => {
  assert.equal(FEATURE_FLAGS['flip-marks']?.stage, 'beta');
  assert.deepEqual(FLIP_MENU_ROWS.map((row) => row.label), ['Horizontal', 'Vertical']);
  const menu = readFileSync(new URL('../src/hooks/useAnnotationContextMenu.jsx', import.meta.url), 'utf8');
  assert.match(menu, /key: 'flip',\n\s+label: 'Flip',/);
  for (const sel of ['\\{ calloutIds: \\[ctx\\.calloutId\\] \\}', '\\{ indices: \\[ctx\\.annotationIndex\\] \\}', 'familySelection']) {
    assert.match(menu, new RegExp(`\\.\\.\\.flipItems\\(${sel}\\)`));
  }
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /flipSelection: flipMarksOn \? flipSelection : null/);
  assert.match(viewer, /action: 'flip', checkpointPolicy: 'normal'/);
  const migration = readFileSync(new URL('../supabase/migrations/20261117123000_flip_marks_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'flip-marks', 'off'/);
});
