import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rotateDisplayedPoint,
  transformPageState,
} from '../src/utils/pageAnnotationReindex.js';

// Source contracts for ellipse / cloud-rect / highlighter export after CW.
// Live proof: debug/scenarios/e2e-page-rotate-shape-export-reimport.spec.mjs
// Distinct from rect/ink/callout/remaining export-after-rotate.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function emptyModel(objects = [], width = 612, height = 792) {
  return {
    annotationsByPage: { 1: { width, height, objects } },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
}

test('CW remapper keeps ellipse center, cloud-rect intensity, highlighter centerline', () => {
  const ellipse = {
    type: 'ellipse',
    left: 110.16,
    top: 174.24,
    rx: 73.44,
    ry: 55.44,
    width: 146.88,
    height: 110.88,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id: 'xf-ell', type: 'ellipse', tool: 'ellipse' },
  };
  const cloud = {
    type: 'rect',
    left: 293.76,
    top: 190.08,
    width: 146.88,
    height: 110.88,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    data: { id: 'xf-cloud', type: 'rect', pdfCloudIntensity: 2 },
  };
  const ink = {
    type: 'path',
    left: 0,
    top: 0,
    path: [],
    paperCenterline: [{ x: 134.64, y: 396.00 }],
    globalCompositeOperation: 'multiply',
    data: { id: 'xf-hi', type: 'path', tool: 'highlighter' },
  };

  const cw = transformPageState(emptyModel([ellipse, cloud, ink]), {
    type: 'rotate',
    page: 1,
    delta: 90,
    pageWidth: 612,
    pageHeight: 792,
  });
  const [afterEll, afterCloud, afterInk] = cw.annotationsByPage[1].objects;
  const ellExpected = rotateDisplayedPoint(110.16 + 146.88 / 2, 174.24 + 110.88 / 2, 612, 792, 90);
  assert.ok(Math.abs((afterEll.left + afterEll.width / 2) - ellExpected.x) < 1e-6);
  assert.equal(afterCloud.data.pdfCloudIntensity, 2);
  const inkExpected = rotateDisplayedPoint(134.64, 396.00, 612, 792, 90);
  assert.ok(Math.abs(afterInk.paperCenterline[0].x - inkExpected.x) < 1e-6);
  assert.equal(afterInk.left, 0);
  assert.equal(cw.annotationsByPage[1].width, 792);
});

test('shape export-after-rotate spec covers ellipse / cloud-rect / highlighter; no file.id stamp', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-shape-export-reimport.spec.mjs');
  const importer = read('src/utils/pdfAnnotationImporter.js');
  const exporter = read('src/utils/pdfAnnotationsPdfLib.js');
  const dev = read('src/DevTestRoute.jsx');

  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /leftover-18 \/ X-01/);
  assert.match(spec, /desktop rotate remapper then export re-import of \$\{kind\}/);
  assert.match(spec, /\['ellipse', createEllipse, isEllipse\]/);
  assert.match(spec, /\['cloud-rect', createCloudRect, isCloudRect\]/);
  assert.match(spec, /\['highlighter', createHighlighter, isHighlighter\]/);
  assert.match(spec, /390 shape-export-reimport edge/);
  assert.match(spec, /re-import must keep swapped viewBox/);
  assert.match(spec, /strip-on-import/);
  assert.match(spec, /0 0 792 612/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);

  assert.match(exporter, /pdfCloudIntensity/);
  assert.match(importer, /pdfCloudIntensity/);
  assert.match(dev, /Do NOT set file\.id/);
});
