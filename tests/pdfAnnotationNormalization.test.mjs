import test from 'node:test';
import assert from 'node:assert/strict';
import { convertInkToFabricPath } from '../src/utils/pdfAnnotationImporter.js';
import { makeInternalPenPathSpec } from '../src/utils/nativeShapeFactory.js';
import { renderPathToSvgAttrs, renderPathToSvgD } from '../src/utils/svgPathAttrs.js';

// UX 2026-04-21 (import-normalization Chunk 2): the imported Ink Fabric
// spec must be field-for-field identical to an internally-drawn pen
// stroke for every behavior-gating field. Provenance fields
// (isPdfImported, pdfAnnotationId, pdfAnnotationType) are allowed to
// differ — they're metadata, not behavior. If this test fails the
// zoom-gap-on-imports bug + the eraser-thickens-imports bug will regress.

const inkAnnotation = {
  id: 'ink-norm-1',
  subtype: 'Ink',
  inkLists: [[10, 10, 20, 20, 30, 15]],
  color: [0, 0, 0],
  borderWidth: 2,
  rect: [0, 0, 100, 100],
};

const viewport = {
  height: 100,
  convertToViewportPoint: (x, y) => [x, 100 - y],
};

test('imported Ink has the same core Fabric properties as an internal pen stroke', () => {
  const imported = convertInkToFabricPath(inkAnnotation, viewport, 1);
  assert.ok(imported, 'convertInkToFabricPath should return a Fabric spec');
  const internal = makeInternalPenPathSpec({
    stroke: imported.stroke,
    strokeWidth: imported.strokeWidth,
  });

  const sharedKeys = ['type', 'fill', 'strokeUniform', 'strokeLineCap', 'strokeLineJoin'];
  for (const key of sharedKeys) {
    assert.equal(
      imported[key],
      internal[key],
      `Field drift on ${key}: imported=${JSON.stringify(imported[key])}, internal=${JSON.stringify(internal[key])}`
    );
  }
});

test('imported Ink preserves isPdfImported flag and pdfAnnotationType as metadata-only', () => {
  const imported = convertInkToFabricPath(inkAnnotation, viewport, 1);
  assert.ok(imported);
  assert.equal(imported.isPdfImported, true);
  assert.equal(imported.pdfAnnotationType, 'Ink');
  // Provenance id should be propagated from the annotation.
  assert.equal(imported.pdfAnnotationId, 'ink-norm-1');
});

test('imported Ink path is normalized to local coords with left/top carrying world position', () => {
  // UX 2026-04-21 (bbox-drift fix): regression test for the pen-stroke
  // resize drift bug. Imported Ink used to carry its path commands in
  // absolute viewport coords with no left/top, which caused
  // svgBoundingBox.getPathBBox Case 2 to double-count the world
  // translation after Fabric set `left` during resize (offsetX + minX*sx
  // instead of just offsetX). Fix: translate path data to local coords
  // at import time and carry the world placement on left/top.
  const ink = {
    id: 'ink-norm-local-1',
    subtype: 'Ink',
    // Two points in PDF coords: (10, 20) and (30, 40).
    inkLists: [[10, 20, 30, 40]],
    color: [0, 0, 0],
    borderWidth: 2,
    rect: [0, 0, 100, 100],
  };
  const vp = { height: 100, convertToViewportPoint: (x, y) => [x, 100 - y] };
  const r = convertInkToFabricPath(ink, vp, 1);
  assert.ok(r);

  // After PDF → viewport flip: point 1 (10, 80), point 2 (30, 60).
  // minX=10, minY=60, maxX=30, maxY=80 → width=20, height=20.
  assert.equal(r.left, 10);
  assert.equal(r.top, 60);
  assert.equal(r.width, 20);
  assert.equal(r.height, 20);

  // Path data should now start at (0, 0) in local coords.
  assert.ok(Array.isArray(r.path) && r.path.length > 0, 'path should be non-empty');
  const firstCmd = r.path[0];
  // First command is ['M', x, y]; verify local coords fit inside [0..width]×[0..height].
  assert.ok(firstCmd[1] >= 0 && firstCmd[1] <= 20, `firstCmd[1]=${firstCmd[1]} out of [0,20]`);
  assert.ok(firstCmd[2] >= 0 && firstCmd[2] <= 20, `firstCmd[2]=${firstCmd[2]} out of [0,20]`);

  // Every subsequent coord pair should also be local (inside the bbox).
  for (const cmd of r.path) {
    for (let j = 1; j + 1 < cmd.length; j += 2) {
      assert.ok(
        cmd[j] >= 0 && cmd[j] <= 20,
        `local x out of [0,20]: cmd=${JSON.stringify(cmd)}`
      );
      assert.ok(
        cmd[j + 1] >= 0 && cmd[j + 1] <= 20,
        `local y out of [0,20]: cmd=${JSON.stringify(cmd)}`
      );
    }
  }
});

test('renderPathToSvgAttrs preserves stroke / fill / cap / join parity for imported vs internal paths', () => {
  // Behavior parity guarantee: stroke color, fill, line caps, line joins,
  // and opacity must NOT diverge based on provenance — the user-visible
  // ink/cap/color identity is the same whether the stroke came from PDF
  // import or from an internal pen-down. Width and vector-effect ARE
  // expected to diverge (see the next test) because the source PDF's
  // hairline widths must be promoted for visibility while internal pens
  // keep their toolbar-specified width verbatim.
  const base = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 10, 10],
    ],
    stroke: '#000',
    strokeWidth: 2,
    fill: null,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  };
  const imported = { ...base, isPdfImported: true, pdfAnnotationType: 'Ink', pdfAnnotationId: 'p1' };
  const internal = { ...base };

  const a = renderPathToSvgAttrs(imported);
  const b = renderPathToSvgAttrs(internal);

  const sharedKeys = ['stroke', 'fill', 'strokeLinecap', 'strokeLinejoin', 'opacity'];
  for (const key of sharedKeys) {
    assert.equal(a[key], b[key], `attr drift on ${key}: imported=${a[key]}, internal=${b[key]}`);
  }
});

test('renderPathToSvgAttrs promotes thin imported paths to visible width + non-scaling-stroke', () => {
  // 2026-04-28 visibility fix: thin PDF strokes (typical /BS borderWidth
  // 0.5-1.1pt) become sub-pixel under the SVG viewBox transform and
  // can fade out at low zoom. Imported open paths get clamped to a
  // visible user-unit floor AND vector-effect:
  // non-scaling-stroke so they stay at-least-one-device-pixel at every
  // zoom — matches Adobe / Drawboard behavior. Internal pen strokes are
  // unaffected because the user picks their width directly.
  const thin = {
    type: 'path',
    path: [['M', 0, 0], ['L', 1, 1]],
    stroke: '#000',
    strokeWidth: 0.9,
    fill: null,
  };
  const importedThin = { ...thin, isPdfImported: true, pdfAnnotationType: 'Ink', pdfAnnotationId: 'p1' };
  const internalThin = { ...thin };

  const importedAttrs = renderPathToSvgAttrs(importedThin);
  const internalAttrs = renderPathToSvgAttrs(internalThin);

  // Imported: clamped + non-scaling. Floor lives in svgPathAttrs.js
  // (IMPORTED_PATH_MIN_STROKE_WIDTH); this test asserts the *behavior*
  // (clamp activates, value is well above 0.9, vector-effect on) without
  // hard-coding the floor number, so visual tuning doesn't break tests.
  assert.ok(importedAttrs.strokeWidth >= 1.5, `imported thin stroke clamps up (got ${importedAttrs.strokeWidth})`);
  assert.ok(importedAttrs.strokeWidth > 0.9, 'imported thin stroke is wider than its raw input');
  assert.equal(importedAttrs.vectorEffect, 'non-scaling-stroke', 'imported gets non-scaling-stroke');

  // Internal: passthrough.
  assert.equal(internalAttrs.strokeWidth, 0.9, 'internal stroke width passes through unchanged');
  assert.equal(internalAttrs.vectorEffect, undefined, 'internal stroke has no vector-effect by default');

  // Already-thick imported strokes are NOT shrunk.
  const thickImported = renderPathToSvgAttrs({
    ...importedThin,
    strokeWidth: 4,
  });
  assert.equal(thickImported.strokeWidth, 4, 'thick imported stroke retains its width');
});

test('closed zero-width PDF Ink imports as a filled outline, not a hollow stroke', () => {
  const closedInk = {
    id: 'ink-filled-outline-1',
    subtype: 'Ink',
    inkLists: [[10, 10, 20, 10, 20, 20, 10, 20, 10.1, 10.1]],
    color: [164, 103, 243],
    borderWidth: 0,
    rect: [0, 0, 100, 100],
  };

  const imported = convertInkToFabricPath(closedInk, viewport, 1);
  assert.ok(imported);
  assert.equal(imported.pdfInkRenderMode, 'filled-outline');
  assert.ok(imported.fill?.startsWith('rgba(164, 103, 243'), `fill should use ink color, got ${imported.fill}`);

  const attrs = renderPathToSvgAttrs(imported);
  assert.equal(attrs.stroke, 'none');
  assert.equal(attrs.strokeWidth, 0);
  assert.equal(attrs.fill, imported.fill);
  assert.equal(attrs.fillRule, 'nonzero');
});

test('legacy closed thin imported Ink rows render filled even without new import marker', () => {
  const legacyCloudRow = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 10, 10],
      ['L', 0, 10],
      ['L', 0.1, 0.1],
    ],
    stroke: 'rgba(164, 103, 243, 0.301961)',
    strokeWidth: 0.9,
    fill: null,
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    pdfAnnotationId: 'legacy-outline',
  };

  const attrs = renderPathToSvgAttrs(legacyCloudRow);
  assert.equal(attrs.stroke, 'none');
  assert.equal(attrs.strokeWidth, 0);
  assert.equal(attrs.fill, legacyCloudRow.stroke);
  assert.equal(attrs.vectorEffect, undefined);

  const d = renderPathToSvgD(legacyCloudRow, attrs);
  assert.match(d, /\bC\b/, 'closed outline should render with smoothed cubic curves');
  assert.match(d, /\bZ\b/, 'closed outline should stay closed for fill rendering');
});
