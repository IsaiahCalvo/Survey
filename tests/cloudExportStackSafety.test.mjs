// Big clouds must survive BOTH writers (2026-09-10, export round 5).
//
// Two defects, both proven by an adversarial export checker on
// claude/cloud-round4-integration:
//
//  1. STACK OVERFLOW. getCloudPathBounds sampled the cloud outline at 100
//     points per cubic and then did `Math.min(...points.map(...))`. A spread
//     passes one ARGUMENT per element, so past roughly 125,000 points V8 threw
//     `RangeError: Maximum call stack size exceeded`. A full-sheet ARCH-E rect
//     cloud at Bump 2 is 1,713 cubics — 171,300 points — and every big cloud
//     crossed the line. The /Annots writer CAUGHT the throw and silently
//     dropped the annotation (the exported PDF carried zero /Annots while the
//     screen showed the cloud); savePDFWithFlattenedRegularAnnotationsForPrint
//     did NOT catch it, so the whole print failed. In a 220-case random sweep
//     17% of filled clouds were dropped.
//
//  2. OVERSIZE OVERLAP DROP. exportAnnotationRefHasValidGeometry required
//     geometry to overlap the page AND stay within one page dimension of it.
//     That is a size limit dressed up as a placement check: a cloud anchored
//     on a Letter page but 1400pt wide, or a cloud resized 6x on its own
//     handles, is drawn by the flattened print but was dropped from the
//     export. The contract is now: any annotation whose BASE geometry OVERLAPS
//     the page at all is exported (viewers clip); only geometry entirely off
//     the page, non-finite or degenerate is rejected.
//
// Every assertion here is about the app's REAL writers, called the way the app
// calls them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFStream } from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { resolveCloudAnnotationGeometry } from '../src/utils/cloudAnnotationGeometry.js';
import { getCloudPathBounds } from '../src/utils/pdfAnnotationAppearance.js';
import { boundsOfPoints, maxOf, minOf } from '../src/utils/arrayExtrema.js';

const STROKE = '#c42747';
const FILL = 'rgba(196, 39, 71, 0.25)';

// Page frames the defect was measured on.
const LETTER = { width: 612, height: 792 };
const ARCH_E = { width: 2500, height: 3370 };
const A5 = { width: 420, height: 595 };

// Real drawing coordinates are decimal; keep them on a 1e-3 grid so the crown
// engine (a pure function of the vertices) fits the same crowns every run.
const grid = (value) => Math.round(value * 1000) / 1000;

const makePdfFile = async ({ width, height }) => {
  const source = await PDFDocument.create();
  const page = source.addPage([width, height]);
  page.setMediaBox(0, 0, width, height);
  page.setCropBox(0, 0, width, height);
  const bytes = await source.save();
  return {
    name: 'stack-safety.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
};

const withWindow = async (fn) => {
  const original = globalThis.window;
  globalThis.window = {};
  try { return await fn(); } finally { globalThis.window = original; }
};

// The writers log a diagnostic line per call; silence it so a 300-case sweep
// does not bury the test output.
const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const exportAnnotated = (file, pageSize, objects) => quiet(() => withWindow(() => (
  savePDFWithAnnotationsPdfLib(
    file,
    { 1: { objects } },
    { 1: pageSize },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'stack-safety' },
  )
)));

const exportFlattened = (file, pageSize, objects) => quiet(() => withWindow(() => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    file,
    { 1: { objects } },
    { 1: pageSize },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'stack-safety' },
  )
)));

/**
 * Every /Annots entry on page 1, with the appearance stream resolved. An
 * appearance is "valid" when /AP /N is a real stream carrying a /BBox with
 * positive extent and a non-empty content stream — which is what a viewer
 * needs to paint anything at all.
 */
const readAnnots = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return [];
  return annots.asArray().map((ref) => {
    const dict = doc.context.lookup(ref);
    const ap = dict instanceof PDFDict ? doc.context.lookup(dict.get(PDFName.of('AP'))) : null;
    const normal = ap instanceof PDFDict ? doc.context.lookup(ap.get(PDFName.of('N'))) : null;
    const bboxArray = normal instanceof PDFStream
      ? doc.context.lookup(normal.dict.get(PDFName.of('BBox')))
      : null;
    const bbox = bboxArray instanceof PDFArray
      ? bboxArray.asArray().map((entry) => Number(doc.context.lookup(entry)?.asNumber?.() ?? NaN))
      : null;
    return {
      subtype: String(dict?.get?.(PDFName.of('Subtype')) ?? ''),
      rect: (doc.context.lookup(dict.get(PDFName.of('Rect'))))?.asArray?.()
        .map((entry) => Number(doc.context.lookup(entry)?.asNumber?.() ?? NaN)) || null,
      hasAppearance: normal instanceof PDFStream,
      appearanceBytes: normal instanceof PDFStream ? (normal.getContents()?.length || 0) : 0,
      bbox,
    };
  });
};

const assertOneValidAppearance = (annots, label) => {
  assert.equal(annots.length, 1, `${label}: expected exactly one exported annotation, got ${annots.length}`);
  const [annot] = annots;
  assert.ok(annot.hasAppearance, `${label}: exported annotation has no /AP /N appearance stream`);
  assert.ok(annot.appearanceBytes > 0, `${label}: /AP /N stream is empty`);
  assert.ok(Array.isArray(annot.bbox) && annot.bbox.length === 4 && annot.bbox.every(Number.isFinite),
    `${label}: /AP /N has no finite /BBox (${JSON.stringify(annot.bbox)})`);
  assert.ok(annot.bbox[2] - annot.bbox[0] > 0 && annot.bbox[3] - annot.bbox[1] > 0,
    `${label}: /AP /N /BBox is degenerate (${JSON.stringify(annot.bbox)})`);
  assert.ok(Array.isArray(annot.rect) && annot.rect.every(Number.isFinite),
    `${label}: /Rect is not finite (${JSON.stringify(annot.rect)})`);
};

// ---------------------------------------------------------------------------
// Shape builders
// ---------------------------------------------------------------------------

/** A convex n-gon inscribed in the page, as the app stores a drawn polygon. */
const polygonCloud = (id, vertexCount, bump, page, { fill = FILL, closed = true, scale = 1 } = {}) => {
  const points = [];
  const cx = page.width / 2; const cy = page.height / 2;
  const rx = page.width * 0.45; const ry = page.height * 0.45;
  for (let index = 0; index < vertexCount; index += 1) {
    const theta = (index / vertexCount) * Math.PI * 2;
    points.push({ x: grid(cx + rx * Math.cos(theta)), y: grid(cy + ry * Math.sin(theta)) });
  }
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  return {
    id,
    type: closed ? 'polygon' : 'polyline',
    left: grid(minX), top: grid(minY),
    points: points.map((point) => ({ x: grid(point.x - minX), y: grid(point.y - minY) })),
    pathOffset: { x: 0, y: 0 },
    scaleX: scale, scaleY: scale,
    stroke: STROKE, strokeWidth: 2.5,
    fill: closed ? fill : 'transparent',
    data: { pdfCloudIntensity: bump },
  };
};

const rectCloud = (id, box, bump, { fill = 'transparent', scale = 1 } = {}) => ({
  id, type: 'rect',
  left: box.left, top: box.top, width: box.width, height: box.height,
  scaleX: scale, scaleY: scale,
  stroke: STROKE, strokeWidth: 2.5, fill,
  data: { pdfCloudIntensity: bump },
});

// ---------------------------------------------------------------------------
// 1. The stack-overflow cases: export AND flatten, valid /AP, no throw.
// ---------------------------------------------------------------------------

// The linear helpers replace `Math.min(...)` / `Math.max(...)` in dozens of
// geometry call sites, so they must agree with the spread EXACTLY - including
// the corners that make a silent difference: NaN propagation, the -0 < +0
// ordering, and the empty-array identities.
test('the linear min/max helpers match Math.min / Math.max exactly', () => {
  const samples = [
    [],
    [3],
    [3, -1, 7, 0],
    [0, -0],
    [-0, 0],
    [1, NaN, 2],
    [Infinity, -Infinity, 0],
    ['4', '-2', 6],
    [1e308, -1e308],
  ];
  for (const values of samples) {
    const label = JSON.stringify(values.map((value) => (Object.is(value, -0) ? '-0' : value)));
    const expectedMin = Math.min(...values);
    const expectedMax = Math.max(...values);
    assert.ok(Object.is(minOf(values), expectedMin), `minOf${label} = ${minOf(values)} vs ${expectedMin}`);
    assert.ok(Object.is(maxOf(values), expectedMax), `maxOf${label} = ${maxOf(values)} vs ${expectedMax}`);
  }

  // 200,000 values: more than a spread can pass, and the answer must still be
  // the real extremum rather than a crash.
  const many = Array.from({ length: 200_000 }, (_, index) => index - 100_000);
  assert.equal(minOf(many), -100_000);
  assert.equal(maxOf(many), 99_999);

  assert.equal(boundsOfPoints([]), null);
  assert.deepEqual(
    boundsOfPoints([{ x: 2, y: -5 }, { x: -3, y: 8 }]),
    { minX: -3, minY: -5, maxX: 2, maxY: 8 },
  );
  // `coerce` reproduces the call sites' own `Number(point?.x) || 0`.
  assert.deepEqual(
    boundsOfPoints([{ x: NaN, y: 4 }, { x: 6, y: undefined }], { coerce: true }),
    { minX: 0, minY: 0, maxX: 6, maxY: 4 },
  );
});

// Before the fix these outlines carried more sampled points than a spread can
// push onto the call stack, so this is the direct unit-level proof.
test('getCloudPathBounds survives an outline with far more samples than a spread allows', () => {
  const commands = [['M', 0, 0]];
  // 4,000 cubics = 400,000 sampled points, over three times the spread limit.
  for (let index = 0; index < 4000; index += 1) {
    const x = index + 1;
    commands.push(['C', x - 0.75, -1, x - 0.25, 1, x, 0]);
  }
  const bounds = getCloudPathBounds(commands);
  assert.ok(bounds, 'expected bounds for a long outline');
  assert.equal(bounds.minX, 0);
  assert.equal(bounds.maxX, 4000);
  assert.ok(bounds.minY < 0 && bounds.maxY > 0, `expected the cubic extrema, got ${JSON.stringify(bounds)}`);
});

const HEAVY_CASES = [
  {
    label: '16-vertex polygon cloud at Bump 2 (Letter)',
    page: LETTER,
    object: () => polygonCloud('poly-16-bump2', 16, 2, LETTER),
  },
  {
    label: '32-vertex polygon cloud at Bump 1 (Letter)',
    page: LETTER,
    object: () => polygonCloud('poly-32-bump1', 32, 1, LETTER),
  },
  {
    label: 'full-sheet rect cloud at Bump 2 (ARCH E)',
    page: ARCH_E,
    object: () => rectCloud('rect-fullsheet', { left: 0, top: 0, width: ARCH_E.width, height: ARCH_E.height }, 2, { fill: FILL }),
  },
  {
    label: '40-point polyline cloud at Bump 2 (Letter)',
    page: LETTER,
    object: () => polygonCloud('polyline-40', 40, 2, LETTER, { closed: false }),
  },
];

for (const entry of HEAVY_CASES) {
  test(`exports and flattens a ${entry.label}`, async () => {
    const object = entry.object();
    const geometry = resolveCloudAnnotationGeometry(object);
    assert.ok(geometry?.outline?.length, `${entry.label}: no cloud outline resolved`);
    // The bounds call is the exact site that used to throw.
    assert.ok(getCloudPathBounds(geometry.outline), `${entry.label}: cloud bounds could not be measured`);

    const annotatedBytes = await exportAnnotated(await makePdfFile(entry.page), entry.page, [object]);
    assertOneValidAppearance(await readAnnots(annotatedBytes), entry.label);

    // The print path used NOT to catch the throw at all, so this half of the
    // test is the "the whole print failed" regression.
    const flattenedBytes = await exportFlattened(await makePdfFile(entry.page), entry.page, [object]);
    assert.ok(flattenedBytes?.length > 0, `${entry.label}: the flattened print produced no bytes`);
  });
}

// One bad annotation must never cost the user every OTHER annotation on the
// sheet. The flattener now fences each draw: the shape that throws is skipped
// with a diagnostic and the rest of the page still prints.
//
// The stack overflow was one instance. The other, still live on the broken
// build, is any text box holding a character the standard PDF fonts cannot
// encode - an emoji, or any non-Latin script. pdf-lib throws
// `WinAnsi cannot encode "屋" (0x5c4b)` from inside the text drawer, and before
// the fence that ONE note failed the whole print: no sheet at all, for every
// annotation on every page.
const UNENCODABLE_TEXT_CASES = [
  ['an emoji in a text box', 'Check the roof 🏠 now'],
  ['a non-Latin script in a text box', '屋根を確認'],
];

for (const [label, text] of UNENCODABLE_TEXT_CASES) {
  test(`the flattened print survives ${label} and still prints the rest of the page`, async () => {
    const good = rectCloud('good', { left: 40, top: 40, width: 200, height: 160 }, 2, { fill: FILL });
    const poison = {
      id: 'poison', type: 'textbox',
      left: 60, top: 300, width: 200, height: 60,
      text, fontSize: 12, fill: '#222222', stroke: 'transparent', strokeWidth: 0,
    };

    const bytes = await exportFlattened(await makePdfFile(LETTER), LETTER, [good, poison]);
    assert.ok(bytes?.length > 0, `${label}: one undrawable annotation must not fail the whole print`);

    // And the good cloud really did print: the page picked up its appearance
    // XObject (drawFlattenedCloud places the /AP form as `CloudAP<n>`).
    const doc = await PDFDocument.load(bytes);
    const resources = doc.context.lookup(doc.getPage(0).node.get(PDFName.of('Resources')));
    const xobjects = resources instanceof PDFDict
      ? doc.context.lookup(resources.get(PDFName.of('XObject')))
      : null;
    assert.ok(xobjects instanceof PDFDict && xobjects.keys().length > 0,
      `${label}: the surviving cloud should still have been flattened onto the page`);
  });
}

// ---------------------------------------------------------------------------
// 2. Oversize geometry that still overlaps the page must be EXPORTED.
// ---------------------------------------------------------------------------

const OVERSIZE_CASES = [
  {
    label: 'a 1400pt-wide cloud anchored on a Letter page',
    page: LETTER,
    object: rectCloud('wide-letter', { left: 100, top: 200, width: 1400, height: 300 }, 2),
  },
  {
    label: 'a 6x-scaled cloud anchored on a Letter page',
    page: LETTER,
    object: rectCloud('scaled-letter', { left: 50, top: 50, width: 300, height: 300 }, 2, { scale: 6 }),
  },
  {
    label: 'a 1400pt-wide cloud anchored on an ARCH E page',
    page: ARCH_E,
    object: rectCloud('wide-arche', { left: 100, top: 200, width: 1400, height: 300 }, 2),
  },
  {
    label: 'a 6x-scaled cloud anchored on an ARCH E page',
    page: ARCH_E,
    object: rectCloud('scaled-arche', { left: 50, top: 50, width: 1200, height: 1200 }, 2, { scale: 6 }),
  },
];

for (const entry of OVERSIZE_CASES) {
  test(`exports ${entry.label}`, async () => {
    const annots = await readAnnots(
      await exportAnnotated(await makePdfFile(entry.page), entry.page, [entry.object]),
    );
    assertOneValidAppearance(annots, entry.label);
  });

  test(`prints ${entry.label}`, async () => {
    const bytes = await exportFlattened(await makePdfFile(entry.page), entry.page, [entry.object]);
    assert.ok(bytes?.length > 0, `${entry.label}: the flattened print produced no bytes`);
  });
}

// The guard still has to do its job. Geometry that is ENTIRELY off the page,
// or not finite, carries no ink a viewer could ever show and stays rejected.
const GARBAGE_CASES = [
  ['a rect parked at x = -9000', rectCloud('far-left', { left: -9000, top: -9000, width: 200, height: 200 }, 2)],
  ['a rect parked far past the right edge', rectCloud('far-right', { left: 9000, top: 200, width: 200, height: 200 }, 2)],
  ['a rect parked far below the page', rectCloud('far-below', { left: 100, top: 9000, width: 200, height: 200 }, 2)],
];

for (const [label, object] of GARBAGE_CASES) {
  test(`still rejects ${label}`, async () => {
    const annots = await readAnnots(
      await exportAnnotated(await makePdfFile(LETTER), LETTER, [object]),
    );
    assert.equal(annots.length, 0, `${label}: off-page garbage must not be exported`);
  });
}

// ---------------------------------------------------------------------------
// 3. Randomised sweep: 300 clouds, up to 40 vertices, up to 6x scale, three
//    page sizes. ZERO may be dropped. On the broken build 17% of the filled
//    clouds in a sweep like this vanished from the export.
// ---------------------------------------------------------------------------

test('a 300-case randomised cloud sweep drops nothing', { timeout: 300_000 }, async () => {
  // xorshift32, fixed seed: the same 300 shapes every run.
  let seed = 0x5eed1234;
  const random = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 0x100000000;
  };
  const pick = (list) => list[Math.floor(random() * list.length) % list.length];

  const pages = [LETTER, A5, ARCH_E];
  const files = new Map();
  for (const page of pages) files.set(page, await makePdfFile(page));

  const drops = [];
  for (let index = 0; index < 300; index += 1) {
    const page = pick(pages);
    const bump = 1 + Math.floor(random() * 6);
    const vertexCount = 3 + Math.floor(random() * 38); // 3..40
    const scale = Math.round((0.5 + random() * 5.5) * 100) / 100; // 0.5x..6x
    const filled = random() < 0.5;
    const kind = pick(['polygon', 'polyline', 'rect', 'ellipse']);

    let object;
    if (kind === 'polygon' || kind === 'polyline') {
      object = polygonCloud(`sweep-${index}`, vertexCount, bump, page, {
        closed: kind === 'polygon',
        fill: filled ? FILL : 'transparent',
        scale,
      });
    } else {
      const box = {
        left: grid(page.width * 0.05 + random() * page.width * 0.2),
        top: grid(page.height * 0.05 + random() * page.height * 0.2),
        width: grid(page.width * (0.2 + random() * 0.7)),
        height: grid(page.height * (0.2 + random() * 0.7)),
      };
      object = kind === 'rect'
        ? rectCloud(`sweep-${index}`, box, bump, { fill: filled ? FILL : 'transparent', scale })
        : {
          id: `sweep-${index}`, type: 'ellipse',
          left: box.left, top: box.top,
          rx: box.width / 2, ry: box.height / 2,
          width: box.width, height: box.height,
          scaleX: scale, scaleY: scale, angle: 0,
          stroke: STROKE, strokeWidth: 2.5,
          fill: filled ? FILL : 'transparent',
          data: { pdfCloudIntensity: bump },
        };
    }

    const descriptor = `#${index} ${kind} bump${bump} v${vertexCount} x${scale} on ${page.width}x${page.height}${filled ? ' filled' : ''}`;
    let annots;
    try {
      // eslint-disable-next-line no-await-in-loop
      annots = await readAnnots(await exportAnnotated(files.get(page), page, [object]));
    } catch (error) {
      drops.push(`${descriptor}: THREW ${error?.constructor?.name}: ${error?.message}`);
      continue;
    }
    if (annots.length !== 1) {
      drops.push(`${descriptor}: exported ${annots.length} annotations`);
    } else if (!annots[0].hasAppearance || annots[0].appearanceBytes === 0) {
      drops.push(`${descriptor}: exported without a usable /AP /N`);
    }
  }

  assert.deepEqual(drops, [], `${drops.length}/300 clouds were dropped or damaged by the export:\n${drops.slice(0, 12).join('\n')}`);
});
