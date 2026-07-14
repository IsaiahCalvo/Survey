import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  doesRectIntersectObject,
  isPointOnObject,
} from '../src/utils/geometryHitTest.js';

test('unfilled rect selects stroke but not blank interior', () => {
  const rect = {
    type: 'rect',
    left: 10,
    top: 20,
    width: 100,
    height: 60,
    fill: 'transparent',
    stroke: '#111',
    strokeWidth: 4,
  };

  assert.equal(isPointOnObject({ x: 60, y: 50 }, rect, 2), false);
  assert.equal(isPointOnObject({ x: 10, y: 50 }, rect, 2), true);
});

test('filled rect selects blank-looking interior only when fill is real', () => {
  const rect = {
    type: 'rect',
    left: 10,
    top: 20,
    width: 100,
    height: 60,
    fill: '#ffee00',
    stroke: '#111',
    strokeWidth: 4,
  };

  assert.equal(isPointOnObject({ x: 60, y: 50 }, rect, 2), true);
});

test('unfilled circle selects stroke but not center', () => {
  const circle = {
    type: 'circle',
    left: 50,
    top: 50,
    radius: 30,
    fill: 'none',
    stroke: '#111',
    strokeWidth: 4,
  };

  assert.equal(isPointOnObject({ x: 80, y: 80 }, circle, 2), false);
  assert.equal(isPointOnObject({ x: 80, y: 50 }, circle, 2), true);
});

test('filled polygon selects interior; unfilled polygon does not', () => {
  const base = {
    type: 'polygon',
    left: 0,
    top: 0,
    points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
    stroke: '#111',
    strokeWidth: 4,
  };

  assert.equal(isPointOnObject({ x: 40, y: 40 }, { ...base, fill: 'none' }, 2), false);
  assert.equal(isPointOnObject({ x: 40, y: 40 }, { ...base, fill: '#00aa55' }, 2), true);
  assert.equal(isPointOnObject({ x: 0, y: 40 }, { ...base, fill: 'none' }, 2), true);
});

test('crossing marquee respects filled polygon interior but not unfilled blank interior', () => {
  const base = {
    type: 'polygon',
    left: 0,
    top: 0,
    points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }],
    stroke: '#111',
    strokeWidth: 4,
  };
  const tinyInteriorMarquee = { left: 35, top: 35, right: 45, bottom: 45 };

  assert.equal(doesRectIntersectObject(tinyInteriorMarquee, { ...base, fill: 'none' }), false);
  assert.equal(doesRectIntersectObject(tinyInteriorMarquee, { ...base, fill: '#00aa55' }), true);
});

test('crossing marquee respects unfilled circle blank interior', () => {
  const circle = {
    type: 'circle',
    left: 80,
    top: 80,
    originX: 'center',
    originY: 'center',
    radius: 30,
    fill: 'none',
    stroke: '#111',
    strokeWidth: 4,
  };
  const tinyInteriorMarquee = { left: 75, top: 75, right: 85, bottom: 85 };
  const topStrokeMarquee = { left: 75, top: 47, right: 85, bottom: 53 };

  assert.equal(doesRectIntersectObject(tinyInteriorMarquee, circle), false);
  assert.equal(doesRectIntersectObject(topStrokeMarquee, circle), true);
});

test('group arrow hit testing follows children, not group bbox', () => {
  const arrow = {
    type: 'group',
    left: 100,
    top: 100,
    width: 120,
    height: 80,
    stroke: '#111',
    strokeWidth: 4,
    objects: [
      { type: 'line', x1: 0, y1: 0, x2: 120, y2: 80, stroke: '#111', strokeWidth: 4 },
      { type: 'triangle', name: 'arrowHead', left: 120, top: 80, width: 12, height: 12, fill: '#111' },
    ],
  };

  assert.equal(isPointOnObject({ x: 110, y: 170 }, arrow, 2), false);
  assert.equal(isPointOnObject({ x: 160, y: 140 }, arrow, 2), true);
  assert.equal(doesRectIntersectObject({ left: 108, top: 168, right: 118, bottom: 178 }, arrow), false);
  assert.equal(doesRectIntersectObject({ left: 155, top: 135, right: 165, bottom: 145 }, arrow), true);
});

test('fabric-7 capitalized serialized types hit-test identically to lowercase', () => {
  // fabric 7 toObject() emits class names ('Textbox', 'Rect', 'IText', …);
  // fabric 5 saves are lowercase. Both must hit. The capitalized forms were
  // silently un-hittable (case-sensitive switch), which made the eraser
  // unable to erase text boxes and newer shapes.
  const textbox = {
    type: 'Textbox',
    left: 10,
    top: 20,
    width: 100,
    height: 30,
    fill: '#000',
  };
  assert.equal(isPointOnObject({ x: 50, y: 35 }, textbox, 2), true);
  assert.equal(isPointOnObject({ x: 300, y: 300 }, textbox, 2), false);

  const itext = { ...textbox, type: 'IText' };
  assert.equal(isPointOnObject({ x: 50, y: 35 }, itext, 2), true);

  const rect = {
    type: 'Rect',
    left: 10,
    top: 20,
    width: 100,
    height: 60,
    fill: '#ffee00',
    stroke: '#111',
    strokeWidth: 4,
  };
  assert.equal(isPointOnObject({ x: 60, y: 50 }, rect, 2), true);
  assert.equal(
    doesRectIntersectObject({ left: 0, top: 0, right: 15, bottom: 25 }, rect),
    true,
  );
});
