// Revision-cloud stroke band: the export must never hang (2026-09-10).
//
// WHY THIS EXISTS. The PDF /AP and the flattened print knock the fill out
// under the stroke band. That used to be a polygon-clipping SUBTRACTION
// (`fill minus band`), which unioned the sampled fill contour with the crown
// lobes and the body polygon - three families that share exactly-coincident
// edges. On that input the sweep line is undefined: one plain convex filled
// polygon cloud spun inside martinez's connectEdges for over ten minutes, and
// a self-crossing one threw. In both cases the export produced no appearance
// and no flattened page AT ALL - the whole document, not just that cloud.
//
// The knockout is a clip now (cloudStrokeBandRings + `W*`), so the only
// boolean left is a union of transversally-overlapping capsules, fenced by a
// coordinate grid, a wall-clock budget and a piece cap. This suite is the
// standing proof that the fence holds: a seeded fuzz over polygons,
// polylines, ellipses and rectangles with random vertices, stroke widths,
// bumps, fills, scales and tilts. Every case must FINISH under its budget and
// hand back geometry a PDF writer can use (or an honest null).
//
// Seeded, so a failure is reproducible: the case index prints with the shape.

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  cloudStrokeBandRings,
  resolveCloudAnnotationGeometry,
} = await import('../src/utils/cloudAnnotationGeometry.js');

// mulberry32 - a tiny deterministic PRNG so every run fuzzes the same 500.
const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const CASES = 500;
// 500ms per shape. The measured worst case in this fuzz is ~2 orders below
// it; the budget exists to catch a stall, not to police milliseconds.
const BUDGET_MS = 500;

const buildCase = (index) => {
  const random = seeded(index * 2654435761);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (low, high) => low + random() * (high - low);
  const kind = pick(['polygon', 'polygon', 'polygon', 'polyline', 'rect', 'ellipse', 'circle']);
  const strokeWidth = Math.round(between(0.5, 12) * 10) / 10;
  const intensity = 1 + Math.floor(random() * 6);
  const fill = pick([
    'rgba(0,0,255,0.3)', 'rgba(196,39,71,0.25)', '#ffcc00', 'transparent', null,
  ]);
  const shared = {
    id: `fuzz-${index}`,
    left: Math.round(between(-40, 300)),
    top: Math.round(between(-40, 220)),
    angle: pick([0, 0, Math.round(between(-180, 180))]),
    scaleX: pick([1, 1, Math.round(between(0.2, 3) * 100) / 100]),
    scaleY: pick([1, 1, Math.round(between(0.2, 3) * 100) / 100]),
    opacity: pick([1, 1, Math.round(between(0.05, 1) * 100) / 100]),
    stroke: 'rgba(196,39,71,1)',
    strokeWidth,
    fill,
    data: { pdfCloudIntensity: intensity },
  };
  if (kind === 'rect') {
    return { ...shared, type: 'rect', width: Math.round(between(4, 320)), height: Math.round(between(4, 240)) };
  }
  if (kind === 'ellipse') {
    return { ...shared, type: 'ellipse', rx: Math.round(between(3, 160)), ry: Math.round(between(3, 120)) };
  }
  if (kind === 'circle') {
    return { ...shared, type: 'circle', radius: Math.round(between(3, 140)) };
  }
  // Polygons and polylines get raw random vertices: self-crossing, nearly
  // coincident and collinear runs are exactly the inputs that broke the old
  // subtraction, so they are IN the population, not filtered out of it.
  const count = 2 + Math.floor(random() * 7);
  const points = [];
  for (let step = 0; step < count; step += 1) {
    points.push({ x: Math.round(between(0, 240)), y: Math.round(between(0, 190)) });
  }
  // A tenth of the cases repeat a vertex outright (a double-click while
  // drawing a polygon does this) and a tenth put three points on one line.
  if (random() < 0.1 && points.length >= 2) points.push({ ...points[points.length - 1] });
  if (random() < 0.1 && points.length >= 2) {
    const a = points[0]; const b = points[1];
    points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return { ...shared, type: kind, points, pathOffset: { x: 0, y: 0 } };
};

test(`stroke band: ${CASES} seeded random clouds each finish under ${BUDGET_MS}ms with usable rings`, () => {
  let slowest = 0;
  let slowestIndex = -1;
  let withRings = 0;
  let pieceMode = 0;
  for (let index = 0; index < CASES; index += 1) {
    const shape = buildCase(index);
    const label = `case ${index}: ${JSON.stringify(shape)}`;
    const geometry = resolveCloudAnnotationGeometry(shape);
    if (!geometry) continue;
    const started = Date.now();
    const band = cloudStrokeBandRings(geometry);
    const elapsed = Date.now() - started;
    if (elapsed > slowest) { slowest = elapsed; slowestIndex = index; }
    assert.ok(elapsed < BUDGET_MS, `${label}\ntook ${elapsed}ms`);
    if (band === null) continue;
    withRings += 1;
    if (band.mode === 'pieces') pieceMode += 1;
    assert.ok(band.mode === 'union' || band.mode === 'pieces', label);
    assert.ok(Array.isArray(band.rings) && band.rings.length >= 1, label);
    for (const ring of band.rings) {
      assert.ok(ring.length >= 3, `${label}\na ring collapsed to ${ring.length} points`);
      for (const point of ring) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${label}\nnon-finite ring vertex`);
      }
    }
  }
  // Filled clouds are ~3/5 of the population, so a healthy run produces a band
  // for a good share of them; a zero here would mean the fuzz stopped testing
  // anything.
  assert.ok(withRings > CASES * 0.3, `only ${withRings}/${CASES} produced a band`);
  console.log(`[cloud fuzz] ${withRings}/${CASES} banded, ${pieceMode} fell back to per-capsule clips, slowest ${slowest}ms (case ${slowestIndex})`);
});

// ---------------------------------------------------------------------------
// End to end: the same population through the real exporter. The band is only
// half the story - what has to never stall is "export this page".
// ---------------------------------------------------------------------------

const { PDFDocument, PDFName } = await import('pdf-lib');
const {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} = await import('../src/utils/pdfAnnotationsPdfLib.js');

const PAGE = { width: 320, height: 240 };
const blankFile = async () => {
  const source = await PDFDocument.create();
  source.addPage([PAGE.width, PAGE.height]);
  const bytes = await source.save();
  return {
    name: 'blank.pdf',
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
};

// 4s per shape covers export + flatten + pdf-lib serialisation on a loaded
// machine; the failure this guards against is measured in minutes.
const EXPORT_BUDGET_MS = 4_000;
const EXPORT_CASES = 48;

test(`export + flatten: ${EXPORT_CASES} of the same random clouds each finish under ${EXPORT_BUDGET_MS}ms`, async () => {
  let slowest = 0;
  for (let index = 0; index < EXPORT_CASES; index += 1) {
    // Stride through the population so the sample is not the first 48.
    const shape = buildCase(index * 7 + 3);
    const label = `case ${index * 7 + 3}: ${JSON.stringify(shape)}`;
    const started = Date.now();
    const annotated = await savePDFWithAnnotationsPdfLib(
      await blankFile(), { 1: { objects: [shape] } }, { 1: PAGE }, null,
      { returnBytes: true, actionType: 'pdf-export', documentId: `fuzz-${index}` },
    );
    const flattened = await savePDFWithFlattenedRegularAnnotationsForPrint(
      await blankFile(), { 1: { objects: [shape] } }, { 1: PAGE }, { returnBytes: true },
    );
    const elapsed = Date.now() - started;
    slowest = Math.max(slowest, elapsed);
    assert.ok(elapsed < EXPORT_BUDGET_MS, `${label}\ntook ${elapsed}ms`);
    assert.ok(annotated instanceof Uint8Array && annotated.byteLength > 0, `${label}\nno annotated bytes`);
    assert.ok(flattened instanceof Uint8Array && flattened.byteLength > 0, `${label}\nno flattened bytes`);
    const doc = await PDFDocument.load(annotated);
    const annots = doc.getPages()[0].node.Annots();
    // Some fuzz shapes are degenerate on purpose (two coincident vertices, a
    // zero-radius ellipse) and legitimately export nothing; what must never
    // happen is a throw, a stall, or a corrupt file.
    if (annots && annots.size() > 0) {
      const dict = doc.context.lookup(annots.get(0));
      const rect = dict.get(PDFName.of('Rect')).asArray().map((value) => value.asNumber());
      assert.ok(rect.every(Number.isFinite), `${label}\nnon-finite /Rect`);
    }
  }
  console.log(`[cloud fuzz] export+flatten slowest ${slowest}ms over ${EXPORT_CASES} cases`);
});

// ---------------------------------------------------------------------------
// The fallback path, forced. It is never taken in the fuzz above (0/500), so
// without this it would rot untested - and it is the thing standing between a
// pathological future input and a broken export.
// ---------------------------------------------------------------------------

test('budget exhausted: the band degrades to per-capsule clips and the /AP still paints the fill', async () => {
  const shape = {
    id: 'budget', type: 'rect', left: 60, top: 50, width: 180, height: 130,
    stroke: 'rgba(196,39,71,1)', strokeWidth: 5, fill: 'rgba(0,0,255,0.3)',
    data: { pdfCloudIntensity: 2 },
  };
  const geometry = resolveCloudAnnotationGeometry(shape);
  const starved = cloudStrokeBandRings(geometry, { budgetMs: -1 });
  assert.equal(starved.mode, 'pieces', 'a zero budget never enters the clipper');
  assert.ok(starved.rings.length > 10, 'the raw capsules come back instead');
  const capped = cloudStrokeBandRings(geometry, { maxPieces: 2 });
  assert.equal(capped, null, 'past the piece cap the caller paints a plain fill');

  // And the writer's own output for the fallback: one clip per capsule, then
  // the same scalloped fill.
  const { buildCloudStrokeBandClipOperators } = await import('../src/utils/pdfAnnotationsPdfLib.js');
  const operators = buildCloudStrokeBandClipOperators(starved, (x, y) => ({ x, y }), 200, 150);
  assert.equal((operators.join('\n').match(/\nW\*\nn/g) || []).length, starved.rings.length,
    'one W* clip per capsule - clip paths intersect, so that is the complement of their union');
});

// The fallback has to LOOK the same, not merely produce operators. Both modes
// are rasterised as page content and compared pixel for pixel: one even-odd
// clip of the unioned band vs N intersected per-capsule clips.
let pdfjs = null;
let napiCanvas = null;
try {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  napiCanvas = await import('@napi-rs/canvas');
} catch { pdfjs = null; napiCanvas = null; }

test('per-capsule clips paint the same pixels as the unioned clip', {
  skip: pdfjs && napiCanvas ? false : 'pdfjs-dist + @napi-rs/canvas not installed',
}, async () => {
  const shape = {
    id: 'modes', type: 'rect', left: 40, top: 30, width: 200, height: 140,
    stroke: 'rgba(196,39,71,1)', strokeWidth: 6, fill: 'rgba(0,0,255,0.35)',
    data: { pdfCloudIntensity: 2 },
  };
  const geometry = resolveCloudAnnotationGeometry(shape);
  const toForm = (x, y) => ({ x, y: PAGE.height - y });
  const streamFor = (band) => [
    'q', '1 1 1 rg', `0 0 ${PAGE.width} ${PAGE.height} re`, 'f', 'Q',
    'q',
    ...buildCloudStrokeBandClipOperators(band, toForm, PAGE.width, PAGE.height),
    '0 0 1 rg',
    ...geometry.fill.flatMap((command) => {
      const [verb, ...values] = command;
      const mapped = [];
      for (let index = 0; index + 1 < values.length; index += 2) {
        const point = toForm(values[index], values[index + 1]);
        mapped.push(point.x.toFixed(4), point.y.toFixed(4));
      }
      if (verb === 'M') return [`${mapped.join(' ')} m`];
      if (verb === 'L') return [`${mapped.join(' ')} l`];
      if (verb === 'C') return [`${mapped.join(' ')} c`];
      return ['h'];
    }),
    'f', 'Q',
  ].join('\n');

  const { buildCloudStrokeBandClipOperators } = await import('../src/utils/pdfAnnotationsPdfLib.js');
  const render = async (text) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.width, PAGE.height]);
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(text)));
    const bytes = await doc.save();
    const task = pdfjs.getDocument({ data: Uint8Array.from(bytes), disableWorker: true, verbosity: 0 });
    const loaded = await task.promise;
    const rendered = await loaded.getPage(1);
    const viewport = rendered.getViewport({ scale: 3 });
    const canvas = napiCanvas.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await rendered.render({ canvasContext: context, viewport }).promise;
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };

  const unioned = cloudStrokeBandRings(geometry);
  assert.equal(unioned.mode, 'union');
  const pieces = cloudStrokeBandRings(geometry, { budgetMs: -1 });
  assert.equal(pieces.mode, 'pieces');
  const [a, b] = await Promise.all([render(streamFor(unioned)), render(streamFor(pieces))]);
  let over = 0;
  let worst = 0;
  for (let index = 0; index < a.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(a[index + channel] - b[index + channel]);
      worst = Math.max(worst, delta);
      if (delta > 8) { over += 1; break; }
    }
  }
  // Not bit-identical, and it cannot be: N intersected clips antialias their
  // shared edges N times where one unioned clip antialiases once, so a hairline
  // along the band's own boundary differs. That hairline is under the crowns,
  // which are painted over it. The tolerance below (0.1% of the page) is two
  // orders inside what a person could see, and a real divergence - the fill
  // surviving inside the band, or vanishing outside it - is thousands of
  // pixels, not hundreds.
  console.log(`[cloud fuzz] union vs per-capsule clips: worst channel delta ${worst}, ${over} pixels over 8`);
  assert.ok(over < a.length / 4 * 0.001, `${over} pixels differ by more than 8/255`);
});
