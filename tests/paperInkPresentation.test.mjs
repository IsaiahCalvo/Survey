import test from 'node:test';
import assert from 'node:assert/strict';

import { projectPaperInkForPresentation } from '../src/utils/paperInkPresentation.js';

const nativeStroke = (overrides = {}) => ({
  type: 'path',
  id: 'pen-1',
  tool: 'pen',
  path: [['M', 10, 30], ['Q', 50, 10, 90, 30]],
  left: 0,
  top: 0,
  scaleX: 1,
  scaleY: 1,
  stroke: '#e11d48',
  strokeWidth: 20,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
  fill: null,
  data: { id: 'pen-1', tool: 'pen', custom: 'keep' },
  ...overrides,
});

test('arming partial erase leaves a native authored curve byte-identical', () => {
  const source = nativeStroke();
  assert.equal(projectPaperInkForPresentation(source), source);
});

test('thin imported PDF Ink stays a compact centerline presentation', () => {
  const imported = nativeStroke({
    tool: undefined,
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    strokeWidth: 2,
  });

  assert.equal(projectPaperInkForPresentation(imported), imported);
});

test('wide imported PDF Ink keeps its authored presentation', () => {
  const imported = nativeStroke({
    tool: undefined,
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    pdfAnnotationId: 'pdf-1',
    strokeWidth: 8,
  });

  assert.equal(projectPaperInkForPresentation(imported), imported);
});

test('converged imported filled ink (item 4) is never re-projected', () => {
  // Fresh imports of pressure ink carry a visible fill + evenodd polygons —
  // the fill guard returns them unchanged; no provenance check needed.
  const converged = nativeStroke({
    tool: undefined,
    path: [['M', 0, 0], ['L', 20, 0], ['L', 20, 10], ['Z']],
    stroke: 'transparent',
    strokeWidth: 0,
    fill: 'rgba(255, 0, 0, 1)',
    fillRule: 'evenodd',
    paperInkGeometry: 'v1',
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    pdfInkRenderMode: 'filled-outline',
  });

  assert.equal(projectPaperInkForPresentation(converged), converged);
});

test('thin native ink stays a compact centerline presentation', () => {
  const thin = nativeStroke({ strokeWidth: 2.5 });

  assert.equal(projectPaperInkForPresentation(thin), thin);
});

test('thin centerlines skip eraser classification work during presentation', () => {
  const thin = nativeStroke({ strokeWidth: 2.5 });
  Object.defineProperty(thin, 'tool', {
    get() {
      throw new Error('thin presentation should not classify eraser eligibility');
    },
  });

  assert.equal(projectPaperInkForPresentation(thin), thin);
});

test('already-erased filled paper geometry is not rebuilt', () => {
  const filled = nativeStroke({
    path: [['M', 0, 0], ['L', 20, 0], ['L', 20, 10], ['Z']],
    stroke: 'transparent',
    strokeWidth: 0,
    fill: '#e11d48',
    fillRule: 'evenodd',
    paperEraserGeometry: 'v1',
  });

  assert.equal(projectPaperInkForPresentation(filled), filled);
});

test('legacy Fabric curves are never flattened for eraser presentation', () => {
  const path = [['M', 0, 50]];
  for (let index = 1; index <= 24; index += 1) {
    const previousX = (index - 1) * 5;
    const x = index * 5;
    path.push(['Q', previousX + 2.5, 50 + Math.sin(index / 3) * 0.4, x, 50]);
  }
  const source = nativeStroke({ path, strokeWidth: 20 });
  const projected = projectPaperInkForPresentation(source);

  assert.equal(projected, source);
  assert.equal(projected.path, path);
  assert.ok(projected.path.every((command) => command[0] === 'M' || command[0] === 'Q'));
});
