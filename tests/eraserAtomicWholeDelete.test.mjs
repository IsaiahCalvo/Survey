import test from 'node:test';
import assert from 'node:assert/strict';

import { eraserStrokeTouchesObject } from '../src/utils/eraserHitTest.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

const edgeCases = [
  {
    name: 'rectangle',
    point: { x: 95, y: 115 },
    object: {
      type: 'rect', left: 100, top: 100, width: 40, height: 30,
      fill: 'transparent', stroke: '#111111', strokeWidth: 2,
    },
  },
  {
    name: 'circle',
    point: { x: 95, y: 120 },
    object: {
      type: 'circle', left: 100, top: 100, radius: 20,
      fill: 'transparent', stroke: '#111111', strokeWidth: 2,
    },
  },
  {
    name: 'ellipse',
    point: { x: 95, y: 120 },
    object: {
      type: 'ellipse', left: 100, top: 100, rx: 30, ry: 20,
      fill: 'transparent', stroke: '#111111', strokeWidth: 2,
    },
  },
  {
    name: 'highly eccentric ellipse',
    point: { x: 100, y: 96 },
    object: {
      type: 'ellipse', left: 0, top: 100, rx: 100, ry: 2,
      fill: 'transparent', stroke: '#111111', strokeWidth: 2,
    },
  },
  {
    name: 'triangle',
    point: { x: 120, y: 145 },
    object: {
      type: 'triangle', left: 120, top: 120, width: 40, height: 40,
      fill: 'transparent', stroke: '#111111', strokeWidth: 2,
    },
  },
  {
    name: 'polygon',
    point: { x: 95, y: 115 },
    object: {
      type: 'polygon', left: 100, top: 100,
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }],
      fill: 'transparent', stroke: '#111111', strokeWidth: 2,
    },
  },
  {
    name: 'line',
    point: { x: 120, y: 95 },
    object: {
      type: 'line', left: 100, top: 100, width: 40, height: 0,
      x1: -20, y1: 0, x2: 20, y2: 0,
      stroke: '#111111', strokeWidth: 2, tool: 'line',
    },
  },
  {
    name: 'arrow',
    point: { x: 120, y: 95 },
    object: {
      type: 'line', left: 100, top: 100, width: 40, height: 0,
      x1: -20, y1: 0, x2: 20, y2: 0,
      stroke: '#111111', strokeWidth: 2, tool: 'arrow',
    },
  },
  {
    name: 'image/stamp',
    point: { x: 95, y: 115 },
    object: {
      type: 'image', tool: 'stamp', left: 100, top: 100, width: 50, height: 30,
    },
  },
  {
    name: 'group',
    point: { x: 95, y: 110 },
    object: {
      type: 'group', left: 100, top: 100, width: 40, height: 20,
      objects: [{
        type: 'rect', left: 0, top: 0, width: 40, height: 20,
        fill: 'transparent', stroke: '#111111', strokeWidth: 2,
      }],
    },
  },
  {
    name: 'counter group',
    point: { x: 95, y: 110 },
    object: {
      type: 'group', left: 100, top: 100, width: 40, height: 20,
      data: { type: 'counter', displayNumber: 1 },
      objects: [{
        type: 'rect', left: 0, top: 0, width: 40, height: 20,
        fill: '#e11d48', stroke: '#ffffff', strokeWidth: 2,
      }],
    },
  },
  {
    name: 'atomic path',
    point: { x: 120, y: 95 },
    object: {
      type: 'path', tool: 'shape', left: 0, top: 0,
      path: [['M', 100, 100], ['L', 140, 100]],
      pathOffset: { x: 0, y: 0 },
      fill: null, stroke: '#111111', strokeWidth: 2,
    },
  },
];

test('partial mode whole-deletes every non-ink atomic annotation on eraser-disk edge overlap', async (t) => {
  for (const [index, entry] of edgeCases.entries()) {
    await t.test(entry.name, () => {
      const id = `atomic-edge-${index}`;
      const object = {
        ...entry.object,
        data: { ...entry.object.data, id },
      };

      assert.equal(
        eraserStrokeTouchesObject({
          eraserPoints: [entry.point],
          eraserRadius: 0,
          object,
        }),
        false,
        'cursor center stays outside the visible annotation',
      );
      assert.equal(
        eraserStrokeTouchesObject({
          eraserPoints: [entry.point],
          eraserRadius: 6,
          object,
        }),
        true,
        'eraser disk overlaps the visible edge',
      );

      const result = erasePageAnnotations({
        pageAnnotations: { objects: [object] },
        eraserPoints: [entry.point],
        eraserRadius: 6,
        mode: 'partial',
      });

      assert.equal(result.didChange, true);
      assert.deepEqual(result.pageAnnotations.objects, []);
      assert.deepEqual(result.changedIds, []);
      assert.deepEqual(result.deletedIds, [id]);
      assert.deepEqual(result.touchedIds, [id]);
    });
  }
});

test('text objects delete only when either eraser mode touches a rendered line box', async (t) => {
  for (const mode of ['partial', 'full']) {
    for (const type of ['Textbox', 'text']) {
      await t.test(`${mode} ${type}`, () => {
        const object = {
          type,
          left: 100,
          top: 100,
          width: 60,
          height: 30,
          text: 'Ink',
          fontSize: 12,
          fill: '#111111',
          data: { id: `${mode}-${type}` },
        };

        const miss = erasePageAnnotations({
          pageAnnotations: { objects: [object] },
          eraserPoints: [{ x: 95, y: 110 }],
          eraserRadius: 6,
          mode,
        });
        assert.equal(miss.didChange, false, 'outer box edge is not text ink');

        const hit = erasePageAnnotations({
          pageAnnotations: { objects: [object] },
          eraserPoints: [{ x: 110, y: 110 }],
          eraserRadius: 2,
          mode,
        });
        assert.equal(hit.didChange, true, 'rendered text line is erasable');
        assert.deepEqual(hit.pageAnnotations.objects, []);
      });
    }
  }
});

const filledEdgeCases = [
  {
    name: 'filled rectangle',
    point: { x: 95, y: 115 },
    object: { type: 'rect', left: 100, top: 100, width: 40, height: 30 },
  },
  {
    name: 'filled circle',
    point: { x: 95, y: 120 },
    object: { type: 'circle', left: 100, top: 100, radius: 20 },
  },
  {
    name: 'filled ellipse',
    point: { x: 95, y: 120 },
    object: { type: 'ellipse', left: 100, top: 100, rx: 30, ry: 20 },
  },
  {
    name: 'filled highly eccentric ellipse',
    point: { x: 100, y: 96 },
    object: { type: 'ellipse', left: 0, top: 100, rx: 100, ry: 2 },
  },
  {
    name: 'filled rotated non-uniformly scaled circle',
    point: { x: 204.25, y: 97.75 },
    object: {
      type: 'circle', left: 100, top: 100, radius: 20,
      scaleX: 5, scaleY: 0.1, angle: 45,
    },
  },
  {
    name: 'filled triangle',
    point: { x: 120, y: 145 },
    object: { type: 'triangle', left: 120, top: 120, width: 40, height: 40 },
  },
  {
    name: 'filled polygon',
    point: { x: 95, y: 115 },
    object: {
      type: 'polygon', left: 100, top: 100,
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }],
    },
  },
];

test('partial mode whole-deletes filled shapes when only the eraser disk reaches their edge', async (t) => {
  for (const [index, entry] of filledEdgeCases.entries()) {
    await t.test(entry.name, () => {
      const id = `filled-atomic-edge-${index}`;
      const object = {
        ...entry.object,
        fill: '#2563eb',
        stroke: 'transparent',
        strokeWidth: 0,
        data: { id },
      };

      assert.equal(
        eraserStrokeTouchesObject({ eraserPoints: [entry.point], eraserRadius: 0, object }),
        false,
        'cursor center stays outside the filled shape',
      );
      assert.equal(
        eraserStrokeTouchesObject({ eraserPoints: [entry.point], eraserRadius: 6, object }),
        true,
        'eraser disk overlaps the filled edge',
      );

      const result = erasePageAnnotations({
        pageAnnotations: { objects: [object] },
        eraserPoints: [entry.point],
        eraserRadius: 6,
        mode: 'partial',
      });

      assert.equal(result.didChange, true);
      assert.deepEqual(result.pageAnnotations.objects, []);
      assert.deepEqual(result.changedIds, []);
      assert.deepEqual(result.deletedIds, [id]);
      assert.deepEqual(result.touchedIds, [id]);
    });
  }
});

test('live Fabric ellipse hit testing measures a non-uniform transform in world pixels', () => {
  const angle = Math.PI / 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const object = {
    type: 'circle',
    radius: 20,
    originX: 'center',
    originY: 'center',
    fill: '#2563eb',
    stroke: 'transparent',
    strokeWidth: 0,
    calcTransformMatrix: () => [
      cos * 5,
      sin * 5,
      -sin * 0.1,
      cos * 0.1,
      200,
      102,
    ],
  };
  const point = {
    x: 200 - cos * 6,
    y: 102 + sin * 6,
  };

  assert.equal(
    eraserStrokeTouchesObject({ eraserPoints: [point], eraserRadius: 0, object }),
    false,
    'cursor center is four world pixels beyond the narrow edge',
  );
  assert.equal(
    eraserStrokeTouchesObject({ eraserPoints: [point], eraserRadius: 6, object }),
    true,
    'six-pixel eraser reaches that edge despite the inverse local scale',
  );
});
