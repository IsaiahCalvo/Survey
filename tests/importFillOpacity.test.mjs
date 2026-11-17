// A see-through fill from Drawboard/Bluebeam (/ca next to a solid /CA border)
// must import see-through, as pdf.js and Drawboard paint it (KAL-371
// side-by-side: SE-011 page 1's revision cloud came in solid red).
import test from 'node:test';
import assert from 'node:assert/strict';
import { convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';

const viewport = {
  height: 100,
  convertToViewportPoint(x, y) { return [x, 100 - y]; },
  convertToViewportRectangle(rect) {
    const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
    return [x1, y1, x2, y2];
  },
};

const cloud = {
  id: 'drawboard-cloud',
  subtype: 'Polygon',
  rect: [10, 10, 90, 70],
  vertices: [10, 10, 50, 60, 90, 20],
  color: new Uint8ClampedArray([250, 50, 55]),
  interiorColor: new Uint8ClampedArray([250, 50, 55]),
  borderWidth: 3,
  borderEffect: { style: 'C', intensity: 1 },
};

function alphaOf(rgba) {
  const match = /rgba\([^)]*,\s*([0-9.]+)\)$/.exec(String(rgba));
  return match ? Number(match[1]) : 1;
}

test('a Drawboard cloud keeps its see-through fill and solid border', () => {
  const shape = convertPdfAnnotationToFabric(cloud, viewport, 1, { CA: 1, ca: 0.301961, fillOpacity: 0.301961 });
  assert.equal(shape.type, 'polygon');
  assert.ok(Math.abs(alphaOf(shape.fill) - 0.301961) < 0.01, `fill was ${shape.fill}`);
  assert.equal(alphaOf(shape.stroke), 1, `stroke was ${shape.stroke}`);
});

test('a fill with only /CA still follows /CA', () => {
  const shape = convertPdfAnnotationToFabric(cloud, viewport, 1, { CA: 0.5 });
  assert.ok(Math.abs(alphaOf(shape.fill) - 0.5) < 0.01, `fill was ${shape.fill}`);
});

test('a fill with no alpha at all stays solid', () => {
  const shape = convertPdfAnnotationToFabric(cloud, viewport, 1, {});
  assert.equal(alphaOf(shape.fill), 1, `fill was ${shape.fill}`);
});
