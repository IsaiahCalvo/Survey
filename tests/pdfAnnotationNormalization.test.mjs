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

test('filled legacy imported Ink rows keep smoothing even if marker metadata is missing', () => {
  const legacyFilledRow = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 10, 0],
      ['L', 10, 10],
      ['L', 0, 10],
      ['L', 0.1, 0.1],
    ],
    stroke: null,
    strokeWidth: 0,
    fill: 'rgba(255, 225, 58, 0.301961)',
    isPdfImported: true,
    pdfAnnotationType: 'Ink',
    pdfAnnotationId: 'legacy-filled-outline',
  };

  const attrs = renderPathToSvgAttrs(legacyFilledRow);
  assert.equal(attrs.stroke, 'none');
  assert.equal(attrs.fill, legacyFilledRow.fill);
  assert.equal(attrs.smoothClosedOutline, true);

  const d = renderPathToSvgD(legacyFilledRow, attrs);
  assert.match(d, /\bC\b/, 'filled legacy outline should still render with smoothed cubic curves');
});

test('synced PDF-layer filled Ink rows keep smoothing even if import flags are missing', () => {
  const syncedRow = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 12, 0],
      ['L', 12, 12],
      ['L', 0, 12],
      ['L', 0.1, 0.1],
    ],
    stroke: null,
    strokeWidth: 0,
    fill: 'rgba(87, 142, 255, 0.301961)',
    layer: 'pdf-annotations',
  };

  const attrs = renderPathToSvgAttrs(syncedRow);
  assert.equal(attrs.stroke, 'none');
  assert.equal(attrs.fill, syncedRow.fill);
  assert.equal(attrs.smoothClosedOutline, true);

  const d = renderPathToSvgD(syncedRow, attrs);
  assert.match(d, /\bC\b/, 'metadata-stripped synced PDF outline should stay smooth');
});

test('metadata-stripped filled outlines stay filled and smooth after sync/edit round-trips', () => {
  const strippedFilledOutline = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 8, 0],
      ['L', 8, 8],
      ['L', 0, 8],
      ['L', 0.1, 0.1],
    ],
    stroke: 'none',
    strokeWidth: 0,
    fill: 'rgba(164, 103, 243, 0.301961)',
  };

  const attrs = renderPathToSvgAttrs(strippedFilledOutline);
  assert.equal(attrs.stroke, 'none');
  assert.equal(attrs.fill, strippedFilledOutline.fill);
  assert.equal(attrs.smoothClosedOutline, true);

  const d = renderPathToSvgD(strippedFilledOutline, attrs);
  assert.match(d, /\bC\b/, 'filled outline should be smoothed without PDF metadata');
});

test('semi-transparent Drawboard marker dots render as true smooth ellipses', () => {
  const markerDot = {
    type: 'path',
    path: [
      ['M', 10, 0],
      ['L', 4, 1],
      ['L', 0, 7],
      ['L', 2, 14],
      ['L', 8, 19],
      ['L', 16, 18],
      ['L', 20, 11],
      ['L', 18, 4],
      ['L', 10.2, 0.1],
    ],
    stroke: null,
    strokeWidth: 0,
    fill: 'rgba(164, 103, 243, 0.301961)',
    opacity: 0.301961,
    layer: 'pdf-annotations',
  };

  const attrs = renderPathToSvgAttrs(markerDot);
  assert.equal(attrs.smoothClosedOutline, true);
  assert.equal(attrs.smoothClosedOutlineAsEllipse, true);

  const d = renderPathToSvgD(markerDot, attrs);
  assert.match(d, /M 20 9.5/, 'ellipse starts at the right edge of the bbox');
  assert.match(d, /\bC\b/, 'ellipse is rendered with cubic arcs');
  assert.match(d, /\bZ\b/, 'ellipse remains closed for fill rendering');
});

test('synced Drawboard marker dots use rgba alpha even when opacity round-trips to 1', () => {
  const syncedMarkerDot = {
    type: 'path',
    path: [
      ['M', 20, 12],
      ['C', 20, 17, 16, 21, 10, 21],
      ['C', 4, 21, 0, 17, 0, 12],
      ['C', 0, 6, 4, 0, 10, 0],
      ['C', 16, 0, 20, 6, 20, 12],
    ],
    stroke: 'none',
    strokeWidth: 0,
    fill: 'rgba(87, 142, 255, 0.301961)',
    opacity: 1,
    layer: 'pdf-annotations',
  };

  const attrs = renderPathToSvgAttrs(syncedMarkerDot);
  assert.equal(attrs.smoothClosedOutlineAsEllipse, true);

  const d = renderPathToSvgD(syncedMarkerDot, attrs);
  assert.match(d, /M 20 10.5/, 'ellipse should replace the cached cubic outline');
});

test('Drawboard red ink outlines with mixed cubic and line commands are rebuilt smooth', () => {
  const redInkOutline = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['C', 4, -2, 9, -2, 12, 0],
      ['L', 14, 3],
      ['L', 13, 8],
      ['C', 9, 11, 4, 11, 1, 8],
      ['L', 0, 0.1],
    ],
    stroke: 'none',
    strokeWidth: 0,
    fill: 'rgba(255, 0, 0, 1)',
    layer: 'pdf-annotations',
  };

  const attrs = renderPathToSvgAttrs(redInkOutline);
  assert.equal(attrs.smoothClosedOutline, true);
  assert.equal(attrs.smoothClosedOutlineAsEllipse, false);

  const d = renderPathToSvgD(redInkOutline, attrs);
  assert.match(d, /\bC\b/, 'mixed Drawboard ink outline should render with smoothed cubic curves');
  assert.doesNotMatch(d, /\bL\b/, 'raw line segments should not leak into closed ink rendering');
  assert.match(d, /\bZ\b/, 'smoothed ink outline should stay closed for fill rendering');
});

test('Drawboard pressure ink keeps original cubic handles when the PDF already has smooth curves', () => {
  const redPressureInk = {
    type: 'path',
    path: [
      ['M', 0.5, 1],
      ['C', 0.6, 0.5, 1.1, 0, 1.7, 0.2],
      ['C', 2.4, 0.4, 2.6, 1.1, 2.2, 1.7],
      ['L', 1.9, 2.1],
      ['C', 1.5, 2.7, 0.7, 2.6, 0.3, 2],
      ['C', 0, 1.6, 0.1, 1.2, 0.5, 1],
      ['Z'],
    ],
    stroke: null,
    strokeWidth: 0.9,
    fill: 'rgba(255, 0, 0, 1)',
    layer: 'pdf-annotations',
  };

  const attrs = renderPathToSvgAttrs(redPressureInk);
  assert.equal(attrs.smoothClosedOutline, true);

  const d = renderPathToSvgD(redPressureInk, attrs);
  assert.match(d, /C 0.6 0.5 1.1 0 1.7 0.2/, 'original Drawboard cubic handles should survive rendering');
  assert.match(d, /L 1.9 2.1/, 'Drawboard connector segments should stay part of the authored outline');
});

test('synced filled Ink rows with tiny open subpaths still smooth the main outline', () => {
  const syncedRow = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['Q', 4, 0, 6, 2],
      ['Q', 8, 4, 6, 6],
      ['Q', 4, 8, 0, 6],
      ['Q', -2, 4, 0, 0],
      ['M', 2, 2],
      ['L', 2.1, 2.1],
    ],
    stroke: null,
    strokeWidth: 0,
    fill: 'rgba(255, 0, 0, 1)',
    layer: 'pdf-annotations',
  };

  const attrs = renderPathToSvgAttrs(syncedRow);
  assert.equal(attrs.smoothClosedOutline, true);

  const d = renderPathToSvgD(syncedRow, attrs);
  assert.match(d, /\bC\b/, 'main outline should be converted to cubic curves');
  assert.match(d, /M 2 2 L 2.1 2.1/, 'tiny open subpath should be preserved');
});
