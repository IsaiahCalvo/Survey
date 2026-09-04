import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convertInkToFabricPath, convertPdfAnnotationToFabric } from '../src/utils/pdfAnnotationImporter.js';
import { makeInternalPenPathSpec } from '../src/utils/nativeShapeFactory.js';
import {
  renderPathToSvgAttrs,
  renderPathToSvgD,
  isFilledInkOutlineAttrs,
  getFilledInkHitTargetProps,
} from '../src/utils/svgPathAttrs.js';

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

const authoredPathD = (object) => (
  object.path.map((command) => command.join(' ')).join(' ')
);

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

test('imported PDF Squiggly uses the native text-markup contract, not a pen path', () => {
  const imported = convertPdfAnnotationToFabric({
    id: 'squiggly-norm-1',
    subtype: 'Squiggly',
    rect: [10, 20, 70, 34],
    color: [1, 0, 0],
    borderStyle: { width: 1.5 },
  }, viewport, 1);
  assert.ok(imported, 'convertPdfAnnotationToFabric should return a Fabric spec');
  assert.equal(imported.type, 'group');
  assert.equal(imported.data.type, 'text-markup');
  assert.equal(imported.data.markupType, 'squiggly');
  assert.ok(imported.data.quads.length > 0);
  assert.equal(imported.lockMovementX, true);
  assert.equal(imported.lockMovementY, true);
  assert.equal(imported.lockScalingX, true);
  assert.equal(imported.lockScalingY, true);
  assert.equal(imported.lockRotation, true);
  assert.equal(imported.pdfAnnotationType, 'Squiggly');
  assert.equal(imported.isPdfImported, true);
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
  // import or from an internal pen-down.
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

test('path presentation preserves dash, phase, and miter style in SVG and canvas lanes', () => {
  const styledPath = {
    type: 'path',
    path: [['M', 0, 0], ['L', 30, 0]],
    stroke: '#111111',
    strokeWidth: 4,
    fill: null,
    strokeLineCap: 'square',
    strokeLineJoin: 'miter',
    strokeMiterLimit: 7,
    strokeDashArray: [0, 10],
    strokeDashOffset: 3,
  };
  const attrs = renderPathToSvgAttrs(styledPath);
  assert.deepEqual(attrs.strokeDasharray, [0, 10]);
  assert.equal(attrs.strokeDashoffset, 3);
  assert.equal(attrs.strokeMiterlimit, 7);
  assert.equal(renderPathToSvgD(styledPath, attrs), authoredPathD(styledPath));

  const svgRendererSource = readFileSync(
    new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url),
    'utf8',
  );
  const overlaySource = readFileSync(
    new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
    'utf8',
  );
  const canvasPainterSource = readFileSync(
    new URL('../src/utils/annotationCanvasPainter.js', import.meta.url),
    'utf8',
  );
  assert.match(svgRendererSource, /strokeDasharray=\{attrs\.strokeDasharray\?\.join\(' '\)\}/);
  assert.match(svgRendererSource, /strokeMiterlimit=\{attrs\.strokeMiterlimit\}/);
  assert.match(overlaySource, /strokeDasharray=\{pathAttrs\.strokeDasharray\?\.join\(' '\)\}/);
  assert.match(canvasPainterSource, /context\.setLineDash\(Array\.isArray\(attrs\.strokeDasharray\)/);
  assert.match(canvasPainterSource, /context\.miterLimit\s*=\s*toNumber\(attrs\.strokeMiterlimit/);
});

test('thin imported Ink preserves its exact native page-unit width at import', () => {
  // Import geometry is source truth: a thin /BS width must not be thickened
  // merely for visibility. Larger hit targets belong to interaction code.
  const thinInk = {
    id: 'ink-thin-import-1',
    subtype: 'Ink',
    inkLists: [[10, 10, 30, 30]],
    color: [0, 0, 0],
    borderWidth: 0.6,
    rect: [0, 0, 100, 100],
  };
  const imported = convertInkToFabricPath(thinInk, viewport, 1);
  assert.equal(imported.strokeWidth, 0.6, 'stored width remains the exact native /BS width');

  // Renderer: pure passthrough of the stored width for BOTH provenances —
  // the render-time imported clamp is retired.
  const attrs = renderPathToSvgAttrs(imported);
  assert.equal(attrs.strokeWidth, imported.strokeWidth, 'render passes the stored width through');
  assert.equal(attrs.vectorEffect, undefined, 'imported stroke scales with zoom (no non-scaling-stroke pin)');

  const internalThin = {
    type: 'path',
    path: [['M', 0, 0], ['L', 1, 1]],
    stroke: '#000',
    strokeWidth: 0.9,
    fill: null,
  };
  const internalAttrs = renderPathToSvgAttrs(internalThin);
  assert.equal(internalAttrs.strokeWidth, 0.9, 'internal stroke width passes through unchanged');
  assert.equal(internalAttrs.vectorEffect, undefined, 'internal stroke has no vector-effect by default');

  // A provenance-flagged path with a thin stored width renders at that stored
  // width — no imported-vs-internal width divergence at render time.
  const legacyThinImported = renderPathToSvgAttrs({ ...internalThin, isPdfImported: true, pdfAnnotationType: 'Ink' });
  assert.equal(legacyThinImported.strokeWidth, 0.9, 'no render-time width branch on provenance');

  // Thick imported widths are exact too.
  const thickInk = convertInkToFabricPath({ ...thinInk, id: 'ink-thick-1', borderWidth: 6 }, viewport, 1);
  assert.equal(thickInk.strokeWidth, 6, 'thick imported stroke keeps its exact width');

  // Legacy strokeUniform opt-ins no longer pin either — one zoom convention
  // for every stroke.
  const legacyUniform = renderPathToSvgAttrs({ ...internalThin, strokeUniform: true });
  assert.equal(legacyUniform.vectorEffect, undefined, 'legacy strokeUniform no longer pins stroke width');
});

test('imported PDF Squiggly stores text quads and never exposes generic stroke scaling', () => {
  const imported = convertPdfAnnotationToFabric({
    id: 'squiggly-width-1',
    subtype: 'Squiggly',
    rect: [10, 20, 70, 34],
    color: [1, 0, 0],
    borderStyle: { width: 4 },
  }, viewport, 1);
  assert.equal(imported.data.type, 'text-markup');
  assert.equal(imported.data.markupType, 'squiggly');
  assert.ok(imported.data.quads.length > 0);
  assert.equal(imported.strokeWidth, undefined);
  assert.equal(imported.lockScalingX, true);
  assert.equal(imported.lockScalingY, true);
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
  // pdfInkRenderMode survives as EXPORT PROVENANCE only.
  assert.equal(imported.pdfInkRenderMode, 'filled-outline');
  assert.ok(imported.fill?.startsWith('rgba(164, 103, 243'), `fill should use ink color, got ${imported.fill}`);

  // Freshly imported filled ink keeps the authored InkList exactly. Import
  // must not invent replacement Catmull-Rom curves before the first edit.
  assert.equal(imported.stroke, 'transparent');
  assert.equal(imported.strokeWidth, 0);
  assert.equal(imported.fillRule, 'evenodd');
  assert.equal(imported.paperInkGeometry, 'v1');
  assert.ok(Array.isArray(imported.polygons) && imported.polygons.length > 0, 'polygons derived at import');
  assert.deepEqual(
    imported.path.map((seg) => seg[0]),
    ['M', 'L', 'L', 'L', 'L'],
    'live path preserves exact authored M/L geometry',
  );

  const attrs = renderPathToSvgAttrs(imported);
  assert.equal(attrs.stroke, 'none');
  assert.equal(attrs.strokeWidth, 0);
  assert.equal(attrs.fill, imported.fill);
  // Native evenodd filledOutline branch — NOT the legacy smoothClosedOutline
  // mode (which is retained only for pre-convergence cloud rows).
  assert.equal(attrs.fillRule, 'evenodd');
  assert.equal(attrs.filledOutline, true);
  assert.notEqual(attrs.smoothClosedOutline, true);
});

test('converged imported filled ink gets the NATIVE filled-ink hit contract', () => {
  const closedInk = {
    id: 'ink-filled-outline-native-hit',
    subtype: 'Ink',
    inkLists: [[10, 10, 20, 10, 20, 20, 10, 20, 10.1, 10.1]],
    color: [164, 103, 243],
    borderWidth: 0,
    rect: [0, 0, 100, 100],
  };
  const imported = convertInkToFabricPath(closedInk, viewport, 1);
  const attrs = renderPathToSvgAttrs(imported);
  // Same interior-hit + boundary-band contract as native paper ink
  // (getFilledInkHitTargetProps native arm) — imported pressure ink is no
  // longer special-cased to the hairline-only imported contract.
  assert.equal(isFilledInkOutlineAttrs(attrs), true);
  const props = getFilledInkHitTargetProps(attrs, { strokeWidth: 1, inverseScale: 1 });
  assert.ok(props);
  assert.equal(props.pointerEvents, 'all');
  assert.equal(props.fillRule, 'evenodd');
  assert.equal(props.stroke, 'rgba(0,0,0,0.001)');
  assert.ok(props.strokeWidth >= 12);
});

test('converged imported marker dots keep authored vertices without inferred ellipse geometry', () => {
  // Low-point semi-transparent closed outline. Legacy rendering inferred an
  // ellipse, which mutated imported geometry; convergence now preserves it.
  const dotInk = {
    id: 'ink-marker-dot-1',
    subtype: 'Ink',
    inkLists: [[10, 20, 16, 19, 20, 13, 18, 6, 12, 1, 4, 2, 0, 9, 2, 16, 10.2, 19.9]],
    color: [164, 103, 243],
    borderWidth: 0,
    rect: [0, 0, 100, 100],
  };
  const imported = convertInkToFabricPath(dotInk, viewport, 1);
  assert.equal(imported.fillRule, 'evenodd');
  assert.ok(Array.isArray(imported.polygons) && imported.polygons.length === 1, 'one dot polygon');
  const ring = imported.polygons[0][0];
  assert.equal(ring.length, 10, 'nine authored points plus the closing point');
  assert.equal(imported.path.some((segment) => segment[0] === 'C'), false);
});

test('legacy closed thin imported Ink rows render their exact authored fill geometry', () => {
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
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.smoothClosedOutline, undefined);

  const d = renderPathToSvgD(legacyCloudRow, attrs);
  assert.equal(d, authoredPathD(legacyCloudRow));
  assert.doesNotMatch(d, /\bC\b/, 'renderer must not invent curves before the first erase');
});

test('filled legacy imported Ink rows keep authored commands when marker metadata is missing', () => {
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
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.smoothClosedOutline, undefined);

  const d = renderPathToSvgD(legacyFilledRow, attrs);
  assert.equal(d, authoredPathD(legacyFilledRow));
});

test('an explicit close command remains authoritative for a metadata-stripped filled outline', () => {
  const explicitlyClosed = {
    type: 'path',
    path: [
      ['M', 0, 0],
      ['L', 20, 0],
      ['L', 20, 20],
      ['Z'],
    ],
    stroke: 'none',
    strokeWidth: 0,
    fill: '#ff0000',
  };

  const sourcePath = structuredClone(explicitlyClosed.path);
  const attrs = renderPathToSvgAttrs(explicitlyClosed);
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.stroke, 'none');
  assert.equal(renderPathToSvgD(explicitlyClosed, attrs), authoredPathD(explicitlyClosed));
  assert.deepEqual(explicitlyClosed.path, sourcePath, 'classification never closes or rewrites the carrier');
});

test('synced PDF-layer filled Ink rows keep authored geometry when import flags are missing', () => {
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
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.smoothClosedOutline, undefined);

  const d = renderPathToSvgD(syncedRow, attrs);
  assert.equal(d, authoredPathD(syncedRow));
});

test('metadata-stripped filled outlines stay filled and exact after sync/edit round-trips', () => {
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
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.smoothClosedOutline, undefined);

  const d = renderPathToSvgD(strippedFilledOutline, attrs);
  assert.equal(d, authoredPathD(strippedFilledOutline));
});

test('semi-transparent Drawboard marker dots retain their authored vertices', () => {
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
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.smoothClosedOutline, undefined);
  assert.equal(attrs.smoothClosedOutlineAsEllipse, undefined);

  const d = renderPathToSvgD(markerDot, attrs);
  assert.equal(d, authoredPathD(markerDot));
  assert.doesNotMatch(d, /\bC\b/);
});

test('synced Drawboard marker dots keep authored cubics when opacity round-trips to 1', () => {
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
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.smoothClosedOutlineAsEllipse, undefined);

  const d = renderPathToSvgD(syncedMarkerDot, attrs);
  assert.equal(d, authoredPathD(syncedMarkerDot));
});

test('Drawboard red ink outlines preserve mixed cubic and line commands', () => {
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
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.smoothClosedOutline, undefined);
  assert.equal(attrs.smoothClosedOutlineAsEllipse, undefined);

  const d = renderPathToSvgD(redInkOutline, attrs);
  assert.equal(d, authoredPathD(redInkOutline));
  assert.match(d, /\bC\b/);
  assert.match(d, /\bL\b/);
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
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.smoothClosedOutline, undefined);

  const d = renderPathToSvgD(redPressureInk, attrs);
  assert.equal(d, authoredPathD(redPressureInk));
});

test('synced filled Ink rows preserve main curves and tiny open subpaths', () => {
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
  assert.equal(attrs.filledOutline, true);
  assert.equal(attrs.smoothClosedOutline, undefined);

  const d = renderPathToSvgD(syncedRow, attrs);
  assert.equal(d, authoredPathD(syncedRow));
  assert.match(d, /\bQ\b/, 'authored quadratic controls survive');
  assert.match(d, /M 2 2 L 2.1 2.1/, 'tiny open subpath survives');
});
