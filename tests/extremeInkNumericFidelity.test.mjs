import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPageAffineToInkObject,
  createInkPathAffine,
} from '../src/utils/inkGeometryTransform.js';
import {
  getAnnotationWorldAABB,
} from '../src/utils/svgBoundingBox.js';
import {
  commandsToPolylines,
} from '../src/utils/paperAnnotationGeometry.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

const pathObject = (overrides = {}) => ({
  type: 'path',
  path: [['M', 0, 0], ['Q', 0.5, 1, 1, 0]],
  left: 0,
  top: 0,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  stroke: '#000',
  strokeWidth: 1,
  ...overrides,
});

test('uniform and nonuniform huge finite scales keep stable singular values', () => {
  const uniform = createInkPathAffine(
    pathObject({ scaleX: 1e150, scaleY: 1e150 }),
    pathObject().path,
  );
  assert.equal(uniform.maxScale, 1e150);
  assert.equal(uniform.minScale, 1e150);
  assert.equal(uniform.conformal, true);
  assert.ok(uniform.matrix.every(Number.isFinite));

  const nonuniform = createInkPathAffine(
    pathObject({ scaleX: 1e160, scaleY: 1 }),
    pathObject().path,
  );
  assert.equal(nonuniform.maxScale, 1e160);
  assert.equal(nonuniform.minScale, 1);
  assert.equal(nonuniform.conformal, false);
  const pagePoint = nonuniform.point(0.25, 0.5);
  const localPoint = nonuniform.inverse(pagePoint);
  assert.ok(Number.isFinite(pagePoint.x) && Number.isFinite(pagePoint.y));
  assert.ok(Math.abs(localPoint.x - 0.25) <= Number.EPSILON);
  assert.ok(Math.abs(localPoint.y - 0.5) <= Number.EPSILON);
});

test('same-sign huge path centers do not create NaN translations', () => {
  const object = pathObject({
    path: [
      ['M', 1e308, 1e308],
      ['L', 1.1e308, 1e308],
    ],
  });
  const affine = createInkPathAffine(object, object.path);
  assert.ok(affine.matrix.every(Number.isFinite));
  const point = affine.point(1e308, 1e308);
  assert.deepEqual(point, { x: 1e308, y: 1e308 });
});

test('same-sign huge Bezier subdivision keeps every midpoint finite', () => {
  const polylines = commandsToPolylines([
    ['M', 1e308, 1e308],
    ['Q', 1.05e308, 1.1e308, 1.1e308, 1e308],
  ], 1e300);
  assert.ok(polylines.length === 1 && polylines[0].points.length > 2);
  assert.ok(
    polylines.flatMap((line) => line.points).every(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
    ),
  );
});

test('finite huge angles are reduced modulo 360 before trigonometry', () => {
  const huge = createInkPathAffine(
    pathObject({ angle: 1e308 }),
    pathObject().path,
  );
  const reduced = createInkPathAffine(
    pathObject({ angle: 1e308 % 360 }),
    pathObject().path,
  );
  assert.deepEqual(huge.matrix, reduced.matrix);

  const bbox = getAnnotationWorldAABB({
    type: 'rect',
    left: 1e150,
    top: 1e150,
    width: 1e140,
    height: 2e140,
    angle: 1e308,
  });
  assert.ok(Object.values(bbox).every(Number.isFinite));
  assert.ok(bbox.width > 0 && bbox.height > 0);
});

test('huge uniform page affine decomposes without determinant overflow', () => {
  const source = pathObject({
    width: 1,
    height: 1,
    pathOffset: { x: 0.5, y: 0.5 },
    originX: 'center',
    originY: 'center',
    inkGeometryOrigin: 'center-v1',
    data: { inkGeometryOrigin: 'center-v1' },
  });
  const transformed = applyPageAffineToInkObject(
    source,
    [1e150, 0, 0, 1e150, 0, 0],
  );
  assert.notEqual(transformed, source);
  assert.equal(transformed.scaleX, 1e150);
  assert.equal(transformed.scaleY, 1e150);
  assert.ok(Number.isFinite(transformed.left));
  assert.ok(Number.isFinite(transformed.top));
  assert.deepEqual(transformed.path, source.path);
});

test('uniform 1e160 ink remains partial-erasable after polygon working-frame normalization', () => {
  const scale = 1e160;
  const object = pathObject({
    id: 'huge-uniform-eraser',
    annotationId: 'huge-uniform-eraser',
    tool: 'pen',
    scaleX: scale,
    scaleY: scale,
    strokeWidth: 0.1,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    data: { id: 'huge-uniform-eraser', tool: 'pen' },
  });
  const result = erasePageAnnotations({
    pageAnnotations: { objects: [object] },
    eraserPoints: [{ x: 0.5 * scale, y: 0.5 * scale }],
    eraserRadius: 0.05 * scale,
    mode: 'partial',
  });

  assert.equal(result.didChange, true);
  assert.deepEqual(result.changedIds, ['huge-uniform-eraser']);
  assert.equal(result.pageAnnotations.objects.length, 1);
  assert.ok(
    result.pageAnnotations.objects[0].path
      .flatMap((command) => command.slice(1))
      .every(Number.isFinite),
    'the survivor stays finite when mapped out of the normalized boolean frame',
  );
});
