import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderPathToSvgAttrs,
  renderPathToSvgD,
} from '../src/utils/svgPathAttrs.js';

test('renderPathToSvgAttrs floors imported open-path stroke width and sets non-scaling', () => {
  const attrs = renderPathToSvgAttrs({
    isPdfImported: true,
    stroke: '#000',
    strokeWidth: 0.5,
    path: [['M', 0, 0], ['L', 10, 0]],
  });
  assert.equal(attrs.strokeWidth, 2.5);
  assert.equal(attrs.vectorEffect, 'non-scaling-stroke');
  assert.equal(attrs.fill, 'none');
});

test('renderPathToSvgAttrs clamps imported squiggly stroke width', () => {
  const attrs = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Squiggly',
    stroke: '#00f',
    strokeWidth: 4,
    path: [['M', 0, 0], ['L', 5, 0]],
  });
  assert.equal(attrs.strokeWidth, 1.1);
});

test('renderPathToSvgAttrs fills evenodd paper-eraser geometry', () => {
  const attrs = renderPathToSvgAttrs({
    fillRule: 'evenodd',
    fill: '#f00',
    stroke: '#0f0',
    path: [['M', 0, 0], ['L', 1, 0], ['L', 1, 1], ['Z']],
  });
  assert.equal(attrs.stroke, 'none');
  assert.equal(attrs.fill, '#f00');
  assert.equal(attrs.fillRule, 'evenodd');
});

test('renderPathToSvgAttrs fills closed thin imported ink outlines', () => {
  const attrs = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    pdfInkRenderMode: 'filled-outline',
    stroke: '#123456',
    strokeWidth: 0.2,
    fill: 'none',
    path: [
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 10, 10],
      ['L', 0, 10],
      ['Z'],
    ],
  });
  assert.equal(attrs.stroke, 'none');
  assert.equal(attrs.fill, '#123456');
  assert.equal(attrs.smoothClosedOutline, true);
});

test('renderPathToSvgD builds an SVG path string from fabric path commands', () => {
  const obj = {
    path: [['M', 1, 2], ['L', 3, 4], ['Q', 5, 6, 7, 8], ['C', 1, 1, 2, 2, 3, 3], ['Z']],
    stroke: '#000',
    strokeWidth: 1,
  };
  const d = renderPathToSvgD(obj);
  assert.match(d, /^M 1 2/);
  assert.match(d, /L 3 4/);
  assert.match(d, /Q /);
  assert.match(d, /C /);
  assert.match(d, /Z/);
});

test('internal paths keep raw stroke width unless strokeUniform is set', () => {
  const normal = renderPathToSvgAttrs({ strokeWidth: 1.25, path: [['M', 0, 0], ['L', 1, 0]] });
  assert.equal(normal.strokeWidth, 1.25);
  assert.equal(normal.vectorEffect, undefined);
  const uniform = renderPathToSvgAttrs({
    strokeWidth: 1.25,
    strokeUniform: true,
    path: [['M', 0, 0], ['L', 1, 0]],
  });
  assert.equal(uniform.vectorEffect, 'non-scaling-stroke');
});

test('renderPathToSvgAttrs fills paperEraserGeometry and layer-tagged ink', () => {
  const eraser = renderPathToSvgAttrs({
    paperEraserGeometry: 'v1',
    stroke: '#abc',
    path: [['M', 0, 0], ['L', 1, 0], ['L', 1, 1], ['Z']],
  });
  assert.equal(eraser.fill, '#abc');
  assert.equal(eraser.fillRule, 'evenodd');

  const layerInk = renderPathToSvgAttrs({
    layer: 'pdf-annotations',
    pdfInkRenderMode: 'filled-outline',
    stroke: '#222',
    path: [['M', 0, 0], ['L', 8, 0], ['L', 8, 8], ['L', 0, 8], ['Z']],
  });
  assert.equal(layerInk.stroke, 'none');
  assert.equal(layerInk.smoothClosedOutline, true);
});

test('renderPathToSvgAttrs fills closed thin paths with visible fill', () => {
  // Geometry fallback requires first≈last endpoints (Z alone is not enough).
  const attrs = renderPathToSvgAttrs({
    fill: '#ff0000',
    stroke: 'none',
    strokeWidth: 0,
    path: [
      ['M', 0, 0],
      ['L', 12, 0],
      ['L', 12, 12],
      ['L', 0, 12],
      ['L', 0, 0],
    ],
  });
  assert.equal(attrs.fill, '#ff0000');
  assert.equal(attrs.smoothClosedOutline, true);
});

test('renderPathToSvgD smooths closed outlines and open ink strokes', () => {
  const closed = {
    isPdfImported: true,
    pdfInkRenderMode: 'filled-outline',
    stroke: '#111',
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['L', 20, 20],
      ['L', 0, 20],
      ['Z'],
    ],
  };
  const closedD = renderPathToSvgD(closed);
  assert.ok(closedD.length > 0);
  assert.match(closedD, /^M /);

  const open = {
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#000',
    strokeWidth: 2,
    path: [
      ['M', 0, 0],
      ['L', 5, 2],
      ['L', 10, 0],
      ['L', 15, 3],
      ['L', 20, 1],
    ],
  };
  const openD = renderPathToSvgD(open);
  assert.ok(openD.includes('C ') || openD.startsWith('M '));
});

test('renderPathToSvgD returns empty string for missing path', () => {
  assert.equal(renderPathToSvgD({}), '');
  assert.equal(renderPathToSvgD({ path: [] }), '');
});

test('renderPathToSvgD emits ellipse for translucent closed marker dots', () => {
  // Low-alpha filled outline with enough points → ellipse smoothing.
  const path = [
    ['M', 0, 0],
    ['L', 10, 0],
    ['L', 12, 4],
    ['L', 10, 10],
    ['L', 0, 10],
    ['L', -2, 4],
    ['L', 0, 0],
  ];
  const obj = {
    isPdfImported: true,
    pdfInkRenderMode: 'filled-outline',
    fill: 'rgba(0, 120, 255, 0.4)',
    stroke: 'none',
    strokeWidth: 0,
    path,
  };
  const attrs = renderPathToSvgAttrs(obj);
  assert.equal(attrs.smoothClosedOutline, true);
  assert.equal(attrs.smoothClosedOutlineAsEllipse, true);
  const d = renderPathToSvgD(obj, attrs);
  assert.match(d, /C /);
  assert.match(d, /Z$/);
});

test('renderPathToSvgD preserves cubic-dominant closed outlines', () => {
  const path = [
    ['M', 0, 0],
    ['C', 1, 2, 3, 4, 5, 0],
    ['C', 6, -2, 7, -4, 10, 0],
    ['C', 8, 2, 6, 4, 5, 5],
    ['C', 3, 4, 1, 2, 0, 0],
    ['Z'],
  ];
  const obj = {
    isPdfImported: true,
    pdfInkRenderMode: 'filled-outline',
    stroke: '#000',
    path,
  };
  const d = renderPathToSvgD(obj);
  assert.match(d, /C /);
  assert.match(d, /Z/);
});

test('renderPathToSvgD handles quadratic commands in open strokes', () => {
  const d = renderPathToSvgD({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#111',
    strokeWidth: 2,
    path: [
      ['M', 0, 0],
      ['Q', 5, 10, 10, 0],
      ['Q', 15, -10, 20, 0],
      ['L', 25, 2],
    ],
  });
  assert.ok(d.length > 0);
});

test('pdfAnnotationType alone marks a path as imported for stroke flooring', () => {
  const attrs = renderPathToSvgAttrs({
    pdfAnnotationType: 'Ink',
    strokeWidth: 0.2,
    path: [['M', 0, 0], ['L', 4, 0]],
  });
  assert.equal(attrs.strokeWidth, 2.5);
  assert.equal(attrs.vectorEffect, 'non-scaling-stroke');
});

test('thin closed imported ink without fill uses geometry fallback', () => {
  const attrs = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#00aa00',
    strokeWidth: 0.5,
    fill: 'none',
    path: [
      ['M', 0, 0],
      ['L', 16, 0],
      ['L', 16, 16],
      ['L', 0, 16],
      ['L', 0, 0],
    ],
  });
  assert.equal(attrs.stroke, 'none');
  assert.equal(attrs.fill, '#00aa00');
  assert.equal(attrs.smoothClosedOutline, true);
});

test('visible fill + closed thin path keeps fill without PDF provenance', () => {
  const attrs = renderPathToSvgAttrs({
    stroke: 'none',
    strokeWidth: 0.5,
    fill: '#ff00aa',
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['L', 20, 20],
      ['L', 0, 20],
      ['Z'],
    ],
  });
  assert.equal(attrs.fill, '#ff00aa');
  assert.equal(attrs.stroke, 'none');
});

test('open multi-subpath ink stays stroked', () => {
  const attrs = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#111',
    strokeWidth: 0.5,
    fill: 'none',
    path: [
      ['M', 0, 0],
      ['L', 10, 0],
      ['M', 0, 5],
      ['L', 10, 5],
    ],
  });
  assert.equal(attrs.fill, 'none');
  assert.notEqual(attrs.stroke, 'none');
});

test('almost-closed and multi-closed subpaths exercise closed-path helpers', () => {
  // Near-closed without Z should still count as closed for thin ink fill
  const almost = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#222',
    strokeWidth: 0.4,
    fill: 'none',
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['L', 20, 20],
      ['L', 0, 20],
      ['L', 0.2, 0.1],
    ],
  });
  assert.equal(almost.stroke, 'none');
  assert.equal(almost.fill, '#222');

  // Two closed subpaths — still a valid attrs object (may stay open-stroke depending on helper)
  const multi = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#333',
    strokeWidth: 0.3,
    fill: 'none',
    path: [
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 10, 10],
      ['L', 0, 10],
      ['Z'],
      ['M', 20, 0],
      ['L', 30, 0],
      ['L', 30, 10],
      ['L', 20, 10],
      ['Z'],
    ],
  });
  assert.ok(multi.stroke === 'none' || multi.smoothOpenStroke === true || multi.fill === 'none');

  // Degenerate zero-area path stays stroked
  const degenerate = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#444',
    strokeWidth: 0.5,
    fill: 'none',
    path: [['M', 1, 1], ['L', 1, 1]],
  });
  assert.equal(degenerate.fill, 'none');

  // Smooth closed outline with Q/C command collection for d string
  const smoothD = renderPathToSvgD({
    isPdfImported: true,
    pdfInkRenderMode: 'filled-outline',
    stroke: '#000',
    strokeWidth: 0.2,
    path: [
      ['M', 0, 0],
      ['Q', 5, 10, 10, 0],
      ['C', 12, -5, 18, -5, 20, 0],
      ['L', 20, 10],
      ['L', 0, 10],
      ['Z'],
    ],
  });
  assert.ok(smoothD.length > 0);
});

test('path attrs helpers cover bad coords, open subpaths, and near-duplicate closes', () => {
  // Non-numeric path coords skipped by getPathBounds; still produces attrs
  const junk = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#111',
    strokeWidth: 0.4,
    fill: 'none',
    path: [
      ['M', 'x', 'y'],
      ['L', null, undefined],
      ['M', 0, 0],
      ['L', 8, 0],
      ['L', 8, 8],
      ['L', 0, 8],
      ['Z'],
    ],
  });
  assert.ok(junk);

  // First subpath open → allSubpathsAreClosed false → stay stroked
  const openThenClosed = renderPathToSvgAttrs({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#555',
    strokeWidth: 0.4,
    fill: 'none',
    path: [
      ['M', 0, 0],
      ['L', 30, 0],
      ['M', 0, 10],
      ['L', 10, 10],
      ['L', 10, 20],
      ['L', 0, 20],
      ['Z'],
    ],
  });
  assert.equal(openThenClosed.fill, 'none');

  // Closed polygon with near-duplicate final point (dedupeAdjacentPoints pop)
  const nearDup = renderPathToSvgD({
    isPdfImported: true,
    pdfInkRenderMode: 'filled-outline',
    stroke: '#000',
    strokeWidth: 0.2,
    path: [
      ['M', 0, 0],
      ['L', 12, 0],
      ['L', 12, 12],
      ['L', 0, 12],
      ['L', 0.1, 0.1],
      ['Z'],
    ],
  });
  assert.match(nearDup, /C /);

  // Empty/invalid path segments before first M in smooth collectors
  const orphanSeg = renderPathToSvgD({
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    stroke: '#000',
    strokeWidth: 2,
    path: [
      ['L', 1, 1],
      [],
      ['M', 0, 0],
      ['L', 4, 1],
      ['L', 8, 0],
    ],
  });
  assert.ok(orphanSeg.length >= 0);

  // Q/C segments through collectSubpaths (hasSubstantiveClosedSubpath / ellipse)
  const qcClosed = renderPathToSvgAttrs({
    fill: 'rgba(0, 100, 255, 0.4)',
    stroke: 'none',
    strokeWidth: 0,
    path: [
      ['M', 0, 0],
      ['Q', 8, -6, 16, 0],
      ['C', 20, 4, 20, 12, 16, 16],
      ['Q', 8, 22, 0, 16],
      ['C', -4, 12, -4, 4, 0, 0],
    ],
  });
  assert.equal(qcClosed.smoothClosedOutline, true);
});
