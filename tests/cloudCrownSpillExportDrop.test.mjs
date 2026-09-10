// FAILING TEST (adversarial verification, 2026-09-10 - verify5-export).
//
// claude/cloud-export-round5 states the export contract as:
//
//   "any annotation whose BASE geometry OVERLAPS the page at all is exported.
//    Viewers clip what runs past the edge; nothing is lost by writing it.
//    Only geometry that is entirely off the page ... is rejected."
//   (exportAnnotationRefHasValidGeometry, src/utils/pdfAnnotationsPdfLib.js)
//
// A revision cloud's INK is not its base geometry. The crowns bulge roughly one
// crown radius (~13pt at Bump 2, stroke 2.5) OUTSIDE the base rectangle, and the
// flattened print draws them. So a cloud whose base rectangle sits a couple of
// points off the page edge still puts a visible band of scallops ON the page -
// and the /Annots export drops it, because the guard judges the base rect, not
// the ink.
//
// Measured on this branch with a plain Bump-2 cloud on Letter (no rotation, no
// flip, scale 1), sliding it off the left edge:
//
//   left = -300  ->  exported 1, print ink on page 2651px
//   left = -302  ->  exported 0, print ink on page 2205px   <-- lost
//   left = -305  ->  exported 0, print ink on page 1555px   <-- lost
//   left = -312  ->  exported 0, print ink on page  251px   <-- lost
//   left = -315  ->  exported 0, print ink on page    0px   (correctly dropped)
//
// (ink measured with poppler pdftoppm at 72dpi on the flattened print; the
// export of the same object carries zero /Annots.) Reproduces on all four page
// edges and for rect, polygon and ellipse clouds.
//
// This is the mirror of the "hull spill" case round 4 fixed - that one was a
// cloud whose base is ON the page and whose hull spills OFF; this one is a
// cloud whose base is OFF and whose hull spills ON. Print and export still
// disagree about whether the annotation exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';

import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  resolveCloudAnnotationGeometry,
  transformCloudCommandsToWorld,
} from '../src/utils/cloudAnnotationGeometry.js';
import { getCloudPathBounds } from '../src/utils/pdfAnnotationAppearance.js';

const PAGE = { width: 612, height: 792 };
const STROKE = '#c42747';
const FILL = 'rgba(196, 39, 71, 0.25)';

const blankFile = async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE.width, PAGE.height]);
  page.setMediaBox(0, 0, PAGE.width, PAGE.height);
  page.setCropBox(0, 0, PAGE.width, PAGE.height);
  const bytes = await source.save();
  return {
    name: 'crown-spill.pdf',
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

const quiet = async (fn) => {
  const { log, warn, error } = console;
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

const exportAnnotated = async (objects) => quiet(() => withWindow(async () => savePDFWithAnnotationsPdfLib(
  await blankFile(), { 1: { objects } }, { 1: PAGE }, null,
  { returnBytes: true, actionType: 'pdf-export', documentId: 'crown-spill' },
)));

const printFlattened = async (objects) => quiet(() => withWindow(async () => (
  savePDFWithFlattenedRegularAnnotationsForPrint(
    await blankFile(), { 1: { objects } }, { 1: PAGE },
    { returnBytes: true, actionType: 'pdf-print', documentId: 'crown-spill' },
  )
)));

const annotCount = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  return annots instanceof PDFArray ? annots.size() : 0;
};

/** Did the flattened print place an appearance XObject on the page at all? */
const printPlacedInk = async (bytes) => {
  const doc = await PDFDocument.load(bytes);
  const resources = doc.context.lookup(doc.getPage(0).node.get(PDFName.of('Resources')));
  const xobjects = resources instanceof PDFDict
    ? doc.context.lookup(resources.get(PDFName.of('XObject')))
    : null;
  return xobjects instanceof PDFDict && xobjects.keys().length > 0;
};

const rectCloud = (id, box, bump = 2) => ({
  id, type: 'rect',
  left: box.left, top: box.top, width: box.width, height: box.height,
  scaleX: 1, scaleY: 1, angle: 0,
  stroke: STROKE, strokeWidth: 2.5, fill: FILL,
  data: { pdfCloudIntensity: bump },
});

// The four placements below all put the BASE rectangle 2pt off one page edge,
// so the crowns (which reach ~13pt further out) sit ON the page.
const CASES = [
  ['left edge', { left: -302, top: 250, width: 300, height: 220 }],
  ['right edge', { left: PAGE.width + 2, top: 250, width: 300, height: 220 }],
  ['top edge', { left: 150, top: -222, width: 300, height: 220 }],
  ['bottom edge', { left: 150, top: PAGE.height + 2, width: 300, height: 220 }],
];

for (const [label, box] of CASES) {
  test(`a cloud whose crowns reach onto the page past the ${label} stays in the export`, async () => {
    const object = rectCloud('crown-spill', box);

    // First: prove the ink really does cross the page edge, in page units, so
    // this test cannot pass by accident on a build that moves the geometry.
    const geometry = resolveCloudAnnotationGeometry(object);
    assert.ok(geometry?.outline?.length, 'the cloud has an outline');
    const local = getCloudPathBounds(geometry.outline);
    assert.ok(local, 'the cloud outline has measurable bounds');
    const worldMinX = object.left + local.minX;
    const worldMaxX = object.left + local.maxX;
    const worldMinY = object.top + local.minY;
    const worldMaxY = object.top + local.maxY;
    assert.ok(
      worldMaxX > 0 && worldMinX < PAGE.width && worldMaxY > 0 && worldMinY < PAGE.height,
      `${label}: the cloud's own ink must overlap the page (got x ${worldMinX}..${worldMaxX}, y ${worldMinY}..${worldMaxY})`,
    );

    // The flattened print draws it - that half is not in dispute.
    const printed = await printFlattened([object]);
    assert.ok(await printPlacedInk(printed), `${label}: the flattened print should draw the crowns`);

    // ...so the /Annots export has to carry it too, or printing and exporting
    // the same sheet disagree about what is on it.
    const exported = await exportAnnotated([object]);
    assert.equal(
      await annotCount(exported), 1,
      `${label}: the print draws this cloud's crowns on the page, so the export must not drop it`,
    );
  });
}

// ---------------------------------------------------------------------------
// 2026-09-10 (export round 6, the fix): the same case for the other two cloud
// kinds. The commit that raised this defect measured it on rect, POLYGON and
// ELLIPSE clouds, and the three take different routes through the writer - a
// rect and an ellipse export as /Square and /Circle judged by /Rect and /RD,
// a polygon exports as /Polygon whose base /Vertices are judged on their own.
// Both routes dropped a cloud whose crowns reach onto the page, so both are
// pinned here.
// ---------------------------------------------------------------------------

/** True world bounds of the painted outline - the ink, crowns included. */
const worldInkBounds = (object) => {
  const geometry = resolveCloudAnnotationGeometry(object);
  assert.ok(geometry?.outline?.length, 'the object is a paintable cloud');
  const bounds = getCloudPathBounds(transformCloudCommandsToWorld(geometry.outline, geometry));
  assert.ok(bounds, 'the cloud outline has measurable bounds');
  return bounds;
};

const polygonCloud = (id, { left, top }, bump = 2) => ({
  id, type: 'polygon',
  left, top,
  points: [{ x: 0, y: 0 }, { x: 300, y: 40 }, { x: 260, y: 220 }, { x: 30, y: 190 }],
  pathOffset: { x: 0, y: 0 },
  scaleX: 1, scaleY: 1, angle: 0,
  stroke: STROKE, strokeWidth: 2.5, fill: FILL,
  data: { pdfCloudIntensity: bump },
});

const ellipseCloud = (id, { left, top, width, height }, bump = 2) => ({
  id, type: 'ellipse',
  left, top, width, height, rx: width / 2, ry: height / 2,
  scaleX: 1, scaleY: 1, angle: 0,
  stroke: STROKE, strokeWidth: 2.5, fill: FILL,
  data: { pdfCloudIntensity: bump },
});

const SPILL_CASES = [
  ['polygon', 'left edge', polygonCloud('poly-left', { left: -302, top: 250 })],
  ['polygon', 'right edge', polygonCloud('poly-right', { left: PAGE.width + 2, top: 250 })],
  ['polygon', 'top edge', polygonCloud('poly-top', { left: 150, top: -222 })],
  ['polygon', 'bottom edge', polygonCloud('poly-bottom', { left: 150, top: PAGE.height + 2 })],
  ['ellipse', 'left edge', ellipseCloud('ell-left', { left: -302, top: 250, width: 300, height: 220 })],
  ['ellipse', 'right edge', ellipseCloud('ell-right', { left: PAGE.width + 2, top: 250, width: 300, height: 220 })],
  ['ellipse', 'top edge', ellipseCloud('ell-top', { left: 150, top: -222, width: 300, height: 220 })],
  ['ellipse', 'bottom edge', ellipseCloud('ell-bottom', { left: 150, top: PAGE.height + 2, width: 300, height: 220 })],
];

for (const [kind, label, object] of SPILL_CASES) {
  test(`${kind === 'ellipse' ? 'an' : 'a'} ${kind} cloud whose crowns reach onto the page past the ${label} stays in the export`, async () => {
    const ink = worldInkBounds(object);
    assert.ok(
      ink.maxX > 0 && ink.minX < PAGE.width && ink.maxY > 0 && ink.minY < PAGE.height,
      `${kind}/${label}: the cloud's own ink must overlap the page (got x ${ink.minX}..${ink.maxX}, y ${ink.minY}..${ink.maxY})`,
    );

    const printed = await printFlattened([object]);
    assert.ok(await printPlacedInk(printed), `${kind}/${label}: the flattened print should draw the crowns`);

    const exported = await exportAnnotated([object]);
    assert.equal(
      await annotCount(exported), 1,
      `${kind}/${label}: the print draws this cloud's crowns on the page, so the export must not drop it`,
    );
  });
}

// The other half of the rule, so widening the guard to the ink bounds cannot
// quietly become "export everything": a cloud far enough out that not one
// crown touches the page carries no ink any viewer could show, and stays out.
test('a cloud whose crowns never reach the page is still dropped', async () => {
  const object = rectCloud('fully-off', { left: -400, top: 250, width: 300, height: 220 });
  const ink = worldInkBounds(object);
  assert.ok(ink.maxX < 0, `the whole cloud must be off the page (ink reaches x ${ink.maxX})`);
  assert.equal(await annotCount(await exportAnnotated([object])), 0, 'off-page geometry is still rejected');
});
