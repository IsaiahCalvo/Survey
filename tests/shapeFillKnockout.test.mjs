// Owner Test 15 (2026-10-02): the colour picker's border-opacity slider.
//
// (1) A just-drawn shape comes up selected with its tool still armed; the
//     first colour / opacity / fill change in the picker must restyle IT (it
//     used to go to the tool's defaults only). A pick left behind under a
//     drawing tool still never takes the tool's changes.
// (2) The Select-mode hover glow traces the shape's own outline: a rectangle's
//     glow has the rectangle's square (miter) corners, centred on the border's
//     own line; every multi-part halo (line + heads, callout box + leaders +
//     head) is ONE group carrying the translucency, so parts never stack.
// (3) A see-through border never shows the fill under its inner half: the
//     fill stops at the stroke's inner edge in every renderer (SVG, canvas
//     painter = thumbnails / lightweight overlay, exported /AP, flattened
//     print), while an opaque border paints exactly as before.
// (B) A just-drawn callout opens its editor with the caret in it: switching
//     the tool back to Select no longer wipes the editor's caret.
//
// Pixel lanes rasterise the real output (node-canvas for the painter, pdf.js
// and poppler for the PDF). A lane whose rasteriser is missing skips.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';

const {
  insetRectForFill,
  paintAlpha,
  sampleEllipsePoints,
  shouldKnockOutShapeFill,
  strokeBandCapsuleRings,
} = await import('../src/utils/shapeFillKnockout.js');
const { drawAnnotationObject } = await import('../src/utils/annotationCanvasPainter.js');
const {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} = await import('../src/utils/pdfAnnotationsPdfLib.js');

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const layerSource = read('../src/components/SVGAnnotationLayer.jsx');
const rendererSource = read('../src/utils/svgAnnotationRenderers.jsx');
const viewerSource = read('../src/PDFViewer.jsx');
const painterSource = read('../src/utils/annotationCanvasPainter.js');
const pdfSource = read('../src/utils/pdfAnnotationsPdfLib.js');

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

test('paintAlpha reads the alpha of every paint form the app writes', () => {
  assert.equal(paintAlpha('rgba(255, 0, 0, 0.4)'), 0.4);
  assert.equal(paintAlpha('rgba(255,0,0,1)'), 1);
  assert.equal(paintAlpha('rgb(255, 0, 0)'), 1);
  assert.equal(paintAlpha('#ff0000'), 1);
  assert.equal(paintAlpha('#ff000080'), 128 / 255);
  assert.equal(paintAlpha('transparent'), 0);
  assert.equal(paintAlpha('none'), 0);
  assert.equal(paintAlpha(''), 0);
  assert.equal(paintAlpha(null), 0);
  assert.equal(paintAlpha('rgba(255, 255, 255, 0)'), 0);
});

test('the fill stops at the stroke only while the border is see-through and there is a fill to show', () => {
  const base = { fill: 'rgba(14, 165, 233, 1)', stroke: 'rgba(255, 0, 0, 0.4)', strokeWidth: 12 };
  assert.equal(shouldKnockOutShapeFill(base), true, '40 % border over a fill');
  assert.equal(shouldKnockOutShapeFill({ ...base, stroke: 'rgba(255, 0, 0, 1)' }), false, 'opaque border: paint exactly as before');
  assert.equal(shouldKnockOutShapeFill({ ...base, stroke: 'rgba(255, 0, 0, 1)', opacity: 0.5 }), true, 'object opacity makes the border see-through too');
  assert.equal(shouldKnockOutShapeFill({ ...base, fill: 'rgba(255, 255, 255, 0)' }), false, 'no visible fill (every new shape)');
  assert.equal(shouldKnockOutShapeFill({ ...base, stroke: 'transparent' }), false, 'no border');
  assert.equal(shouldKnockOutShapeFill({ ...base, strokeWidth: 0 }), false, 'zero width');
});

test('insetRectForFill pulls the box in by half the stroke width and never goes negative', () => {
  assert.deepEqual(insetRectForFill({ x: 10, y: 20, width: 100, height: 50 }, 12), { x: 16, y: 26, width: 88, height: 38 });
  assert.deepEqual(insetRectForFill({ x: 0, y: 0, width: 8, height: 8 }, 20), { x: 4, y: 4, width: 0, height: 0 });
});

test('stroke band capsules cover the inner half of the stroke and nothing deeper', () => {
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const rings = strokeBandCapsuleRings(square, { closed: true, halfWidth: 6 });
  assert.equal(rings.length, 4, 'one capsule per edge, the closing edge included');
  const inside = (point, ring) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i]; const b = ring[j];
      if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const inBand = (point) => rings.some((ring) => inside(point, ring));
  assert.ok(inBand({ x: 50, y: 4 }), 'inner half of the top edge is in the band');
  assert.ok(inBand({ x: 3, y: 3 }), 'the inside of a corner is in the band');
  assert.ok(!inBand({ x: 50, y: 8 }), 'deeper than half the stroke is fill');
  assert.ok(!inBand({ x: 50, y: 50 }), 'the middle is fill');
  assert.equal(strokeBandCapsuleRings(square, { closed: false, halfWidth: 6 }).length, 3, 'an open outline has no closing capsule');
  const ellipse = sampleEllipsePoints({ cx: 0, cy: 0, rx: 100, ry: 50 });
  assert.ok(ellipse.length >= 48, 'an ellipse is sampled finely');
});

// ---------------------------------------------------------------------------
// Source guards (the SVG layer is JSX; the browser harness proves its pixels)
// ---------------------------------------------------------------------------

test('(1) the just-drawn mark is published with the selection and the paint handlers restyle it', () => {
  assert.match(layerSource, /justDrawnRef\.current = \{ id: getAnnotationRenderIdentity\(json\)\.annotationId, tool: activeTool \};\s*selectAnnotation\(/,
    'both commit paths remember the mark they auto-select');
  assert.equal((layerSource.match(/justDrawnRef\.current = \{ id: getAnnotationRenderIdentity\(json\)\.annotationId, tool: activeTool \}/g) || []).length, 2,
    'drag-out shapes and polygon / polyline drafts');
  assert.match(layerSource, /justDrawn: Boolean\(drawn && drawn\.id && drawn\.id === annotationIds\[0\] && drawn\.tool === activeTool\)/);
  assert.match(layerSource, /if \(justDrawnRef\.current && justDrawnRef\.current\.tool !== activeTool\) justDrawnRef\.current = null;/,
    'a tool switch forgets it');
  assert.match(viewerSource, /return \{ pageNumber, annotationIndex, annotation, justDrawn \};/);
  assert.match(viewerSource, /const isJustDrawnMarkSelected = \(\) => selectedToolbarAnnotationRef\.current\?\.justDrawn === true;/);
  for (const name of ['handleStrokeColorChange', 'handleStrokeOpacityChange', 'handleFillColorChange', 'handleFillOpacityChange']) {
    const start = viewerSource.indexOf(`const ${name} = useCallback`);
    const block = viewerSource.slice(start, viewerSource.indexOf('}, [', start));
    assert.match(block, /if \(pickBarTool !== 'select'\) \{\s*if \(isJustDrawnMarkSelected\(\)/, `${name} restyles the just-drawn mark`);
    assert.ok(block.indexOf('updateToolPreference') < block.indexOf('isJustDrawnMarkSelected'), `${name} still updates the tool for the next mark`);
  }
});

test('(2) the hover glow traces the outline: square corners on a rect, centred on the border, one group per multi-part halo', () => {
  const rectGlow = layerSource.slice(layerSource.indexOf('data-hover-glow="rect"') - 900, layerSource.indexOf('data-hover-glow="rect"'));
  assert.match(rectGlow, /strokeLinejoin="miter"/, 'the rectangle glow has square corners');
  assert.doesNotMatch(rectGlow, /strokeLinejoin="round"/);
  assert.match(rectGlow, /x=\{rectL \+ rectGlowInset\}/, 'centred on the border line of an inset-contract rect');
  assert.match(layerSource, /const HOVER_HALO_OPACITY = 0\.4;/);
  for (const kind of ['callout', 'path']) {
    assert.match(layerSource, new RegExp(`data-hover-halo=("${kind}"|\\{isArrow \\? 'arrow' : 'line'\\})`), `${kind} halo is one group`);
  }
  assert.match(layerSource, /data-hover-halo=\{isArrow \? 'arrow' : 'line'\}\s*opacity=\{HOVER_HALO_OPACITY\}/, 'line / arrow halo is one translucent group');
  const callout = layerSource.slice(layerSource.indexOf('data-hover-halo="callout"') - 2400, layerSource.indexOf('data-hover-halo="callout"') + 1200);
  assert.match(callout, /const glowBoxH = tbH \+ calloutFs \* 0\.35;/, 'the callout halo uses the box renderCallout draws');
  assert.match(callout, /calculateCalloutConnection\(\s*tbX, tbY, tbW, glowBoxH,/, 'and the leader renderCallout draws');
  assert.doesNotMatch(callout, /strokeOpacity=/, 'no part carries its own translucency');
});

test('(3) every renderer stops the fill at the stroke under a see-through border', () => {
  assert.match(rendererSource, /<KnockoutRect\s+key=\{key\}/, 'renderRect');
  assert.match(rendererSource, /tag="ellipse"/, 'renderEllipse (mask)');
  assert.match(rendererSource, /tag="polygon"/, 'renderPolygon (mask)');
  assert.match(rendererSource, /insetRectForFill\(\{ x: 0, y: 0, width: effectiveWidth, height: effectiveHeight \}, obj\.strokeWidth\)/, 'renderText background');
  assert.match(painterSource, /paintKnockedOutFill\(context, traceShape/, 'canvas ellipse');
  assert.match(painterSource, /paintKnockedOutFill\(context, tracePoints/, 'canvas polygon');
  assert.match(pdfSource, /drawFillOutsideStrokeBand\(page, points,/, 'pdf polygon');
  assert.match(pdfSource, /drawFillOutsideStrokeBand\(page, outline,/, 'pdf ellipse');
  assert.match(pdfSource, /const inner = insetRectForFill\(\{ x: left, y: top, width, height \}, strokeWidth\);/, 'pdf rect');
});

test('(B) a just-drawn callout keeps its caret when the tool flips back to Select', () => {
  const start = viewerSource.indexOf("if (activeTool !== 'text-select') {");
  const block = viewerSource.slice(start, start + 900);
  assert.match(block, /document\.activeElement\?\.isContentEditable/);
  assert.ok(block.indexOf('isContentEditable') < block.indexOf('clearLiveTextSelection();'), 'an open editor is checked before the selection is cleared');
});

// ---------------------------------------------------------------------------
// Pixel lanes
// ---------------------------------------------------------------------------

const SCALE = 2;
const PAGE = { width: 360, height: 260 };
const STROKE = { r: 196, g: 39, b: 71, a: 0.4 };
const strokePaint = `rgba(${STROKE.r}, ${STROKE.g}, ${STROKE.b}, ${STROKE.a})`;
const FILL = [0, 0, 255];
const fillPaint = `rgba(${FILL.join(', ')}, 1)`;
const drawn = { strokeRenderContract: 'drawn-centered-stroke' };
const OBJECTS = [
  { id: 'r', type: 'rect', left: 40, top: 40, width: 120, height: 80, stroke: strokePaint, fill: fillPaint, strokeWidth: 12, data: drawn },
  { id: 'e', type: 'ellipse', left: 200, top: 40, rx: 60, ry: 40, stroke: strokePaint, fill: fillPaint, strokeWidth: 12, data: drawn },
  {
    id: 'p', type: 'polygon', left: 40, top: 150, width: 120, height: 70, pathOffset: { x: 0, y: 0 },
    points: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 60, y: 70 }], stroke: strokePaint, fill: fillPaint, strokeWidth: 12,
  },
];
// [inner half of the border, interior] per object, in page units.
const PROBES = {
  rect: [{ x: 43, y: 80 }, { x: 100, y: 80 }],
  ellipse: [{ x: 203, y: 80 }, { x: 260, y: 80 }],
  polygon: [{ x: 100, y: 153 }, { x: 100, y: 170 }],
};
const over = (top, alpha, under) => Math.round(under * (1 - alpha) + top * alpha);
const STROKE_OVER_PAGE = [over(STROKE.r, STROKE.a, 255), over(STROKE.g, STROKE.a, 255), over(STROKE.b, STROKE.a, 255)];
const STROKE_OVER_FILL = FILL.map((channel, index) => over([STROKE.r, STROKE.g, STROKE.b][index], STROKE.a, channel));
const pixelAt = (png, point) => {
  const index = (Math.round(point.y * SCALE) * png.width + Math.round(point.x * SCALE)) * 4;
  return [png.data[index], png.data[index + 1], png.data[index + 2]];
};
const distance = (a, b) => Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
const assertNoFillUnderBorder = (png, lane) => {
  for (const [name, [band, interior]] of Object.entries(PROBES)) {
    const onBand = pixelAt(png, band);
    const inside = pixelAt(png, interior);
    assert.ok(distance(inside, FILL) <= 3, `${lane} ${name}: interior is the fill (${inside})`);
    assert.ok(distance(onBand, STROKE_OVER_PAGE) <= 4,
      `${lane} ${name}: inner half of the border ${onBand} must be border over page ${STROKE_OVER_PAGE}, not border over fill ${STROKE_OVER_FILL}`);
  }
};

const tmp = mkdtempSync(join(tmpdir(), 'shape-knockout-'));
const has = (command) => spawnSync('which', [command], { encoding: 'utf8' }).status === 0;

let nodeCanvas = null;
try { nodeCanvas = await import('canvas'); } catch { nodeCanvas = null; }

test('pixels (canvas painter): the border never shows the fill under it, and earlier marks survive', { skip: nodeCanvas ? false : 'node-canvas not installed' }, () => {
  const canvas = nodeCanvas.createCanvas(PAGE.width * SCALE, PAGE.height * SCALE);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  context.fillStyle = 'rgb(0, 128, 0)';
  context.fillRect(196, 76, 4, 4); // under the ellipse's left border
  for (const object of OBJECTS) drawAnnotationObject(context, object, 1);
  const png = PNG.sync.read(canvas.toBuffer('image/png'));
  assertNoFillUnderBorder(png, 'canvas');
  const under = pixelAt(png, { x: 197, y: 77 });
  assert.ok(distance(under, [over(STROKE.r, STROKE.a, 0), over(STROKE.g, STROKE.a, 128), over(STROKE.b, STROKE.a, 0)]) <= 4,
    `a mark painted earlier is not punched out by the knockout (${under})`);
});

test('pixels (canvas painter): an opaque border paints exactly as before', { skip: nodeCanvas ? false : 'node-canvas not installed' }, () => {
  const canvas = nodeCanvas.createCanvas(PAGE.width * SCALE, PAGE.height * SCALE);
  const context = canvas.getContext('2d');
  context.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const calls = [];
  const recorder = new Proxy(context, {
    get(target, key) {
      const value = target[key];
      if (typeof value !== 'function') return value;
      return (...args) => { calls.push(String(key)); return value.apply(target, args); };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  drawAnnotationObject(recorder, { ...OBJECTS[1], stroke: 'rgba(196, 39, 71, 1)' }, 1);
  assert.ok(!calls.includes('drawImage'), 'no scratch layer for an opaque border');
  assert.ok(calls.includes('fill') && calls.includes('stroke'), 'one path, filled and stroked');
});

const blankPdfFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const bytes = await source.save();
  return {
    name: 'blank.pdf',
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
};
const withWindow = async (fn) => {
  const original = globalThis.window;
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.window = original; }
};
const bytesOf = (result) => (result instanceof Uint8Array ? result : result?.bytes || result?.pdfBytes || result);
let exported = null;
const exportsOnce = async () => {
  if (exported) return exported;
  const annotated = bytesOf(await withWindow(async () => savePDFWithAnnotationsPdfLib(
    await blankPdfFile(), { 1: { objects: OBJECTS } }, { 1: PAGE }, null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'shape-knockout' },
  )));
  const flattened = bytesOf(await withWindow(async () => savePDFWithFlattenedRegularAnnotationsForPrint(
    await blankPdfFile(), { 1: { objects: OBJECTS } }, { 1: PAGE }, { returnBytes: true },
  )));
  exported = { annotated, flattened };
  return exported;
};

let pdfjs = null;
let napiCanvas = null;
try {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  napiCanvas = await import('@napi-rs/canvas');
} catch { pdfjs = null; napiCanvas = null; }
const rasterPdf = async (bytes) => {
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = napiCanvas.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  return PNG.sync.read(canvas.toBuffer('image/png'));
};

test('pixels (pdf.js): the exported /AP and the flattened print stop the fill at the border', { skip: pdfjs && napiCanvas ? false : 'pdfjs-dist + @napi-rs/canvas not installed' }, async () => {
  const { annotated, flattened } = await exportsOnce();
  assertNoFillUnderBorder(await rasterPdf(annotated), 'pdf.js /AP');
  assertNoFillUnderBorder(await rasterPdf(flattened), 'pdf.js flattened');
});

test('pixels (poppler): the flattened print stops the fill at the border', { skip: has('pdftoppm') ? false : 'pdftoppm not installed' }, async () => {
  const { flattened } = await exportsOnce();
  const pdfPath = join(tmp, 'flattened.pdf');
  writeFileSync(pdfPath, flattened);
  const result = spawnSync('pdftoppm', ['-r', String(72 * SCALE), '-png', '-singlefile', pdfPath, join(tmp, 'poppler')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assertNoFillUnderBorder(PNG.sync.read(readFileSync(join(tmp, 'poppler.png'))), 'poppler');
});
