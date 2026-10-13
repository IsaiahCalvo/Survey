// w43 (2026-09-26, owner request): text boxes and callouts take line style
// Cloud for the BOX border. There is still one cloud - the house v17 engine
// (tests/revisionCloudGeometryParity.test.mjs) - so a clouded box border must
// be byte-identical to a clouded rectangle of the same box in every path, and
// a callout's leader line and arrowhead must never cloud or dash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFArray, PDFDocument, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import {
  calloutBoxCloudStandIn,
  calloutCloudIntensity,
  colorWithAlpha,
  textboxCloudIntensity,
  textboxCloudStandIn,
  toolOffersCloudLineStyle,
} from '../src/utils/textCloudBorder.js';
import { resolveCloudAnnotationGeometry } from '../src/utils/cloudAnnotationGeometry.js';
import { resolveAnnotationCloudSpec, toolSupportsCloudBorderStyle } from '../src/utils/pdfAnnotationAppearance.js';
import { calloutLineDashArray } from '../src/components/Callout/types.js';
import { drawAnnotationObject, paintAnnotationCanvas } from '../src/utils/annotationCanvasPainter.js';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import {
  annotationObjectToCallout,
  calloutToAnnotationObject,
} from '../src/utils/calloutAnnotationBridge.js';
import { buildNewTextCommitJSON } from '../src/utils/textEditCommit.js';
import { withCloudBandBudgetHeld } from './helpers/cloudBandBudgetClock.mjs';
import {
  applyRestyleChange,
  calloutRestylePatch,
  readCalloutRestyleStyle,
  readRestyleStyle,
  restyleCapabilities,
} from '../src/utils/selectionRestyle.js';

const textbox = (extra = {}) => ({
  type: 'Textbox',
  id: 'tb-cloud',
  left: 40,
  top: 50,
  width: 160,
  height: 60,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  text: 'Clouded note',
  fontSize: 14,
  fontFamily: 'Helvetica',
  fill: '#1e293b',
  stroke: '#dc2626',
  strokeWidth: 2,
  backgroundColor: '',
  opacity: 1,
  data: { pdfCloudIntensity: 3 },
  ...extra,
});

const rectTwin = (tb) => ({
  type: 'rect',
  id: tb.id,
  left: tb.left,
  top: tb.top,
  width: tb.width,
  height: tb.height,
  scaleX: 1,
  scaleY: 1,
  angle: tb.angle || 0,
  stroke: tb.stroke,
  strokeWidth: tb.strokeWidth,
  fill: 'transparent',
  opacity: tb.opacity,
  data: { pdfCloudIntensity: tb.data.pdfCloudIntensity },
});

const makeCallout = (style = {}) => ({
  id: 'callout-cloud',
  pageNumber: 1,
  arrowTip: { x: 0.1, y: 0.1 },
  knee: { x: 0.2, y: 0.2 },
  textBoxPosition: { x: 0.3, y: 0.3 },
  textBoxWidth: 0.4,
  textBoxHeight: 0.12,
  text: 'Clouded callout',
  style: { fontColor: '#1e293b', fontSize: 14, lineThickness: 2, borderColor: '#1e293b', ...style },
});

test('Cloud is offered for the text box and callout tools, and never for a line, arrow or counter', () => {
  for (const tool of ['text', 'textbox', 'callout', 'rect', 'ellipse', 'polygon', 'polyline']) {
    assert.equal(toolOffersCloudLineStyle(tool), true, tool);
  }
  for (const tool of ['arrow', 'line', 'counter', 'pen', 'highlighter', '', null]) {
    assert.equal(toolOffersCloudLineStyle(tool), false, String(tool));
  }
  // The SHAPE predicate is unchanged: a text box is not a cloud-shaped mark,
  // so hit testing, handles and paint preferences never treat it as one.
  assert.equal(toolSupportsCloudBorderStyle('textbox'), false);
  assert.equal(resolveAnnotationCloudSpec(textbox()), null);
});

test('a clouded text box border is exactly the house rectangle cloud of its box', () => {
  const tb = textbox();
  assert.equal(textboxCloudIntensity(tb), 3);
  const standIn = textboxCloudStandIn(tb);
  const fromStandIn = resolveCloudAnnotationGeometry(standIn);
  const fromRect = resolveCloudAnnotationGeometry(rectTwin(tb));
  assert.ok(fromStandIn && fromRect);
  assert.deepEqual(fromStandIn.outlineRuns, fromRect.outlineRuns);
  assert.deepEqual(fromStandIn.origin, fromRect.origin);
  // The text colour is never the cloud's fill; the box background is.
  assert.equal(standIn.fill, 'transparent');
  assert.equal(textboxCloudStandIn(textbox({ backgroundColor: '#fde68a' })).fill, '#fde68a');
  // Not clouded / no border to cloud -> the plain branch draws it.
  assert.equal(textboxCloudStandIn(textbox({ data: {} })), null);
  assert.equal(textboxCloudStandIn(textbox({ strokeWidth: 0 })), null);
});

test('a clouded callout clouds only its box; the leader never takes a dash or a cloud', () => {
  const callout = makeCallout({ lineStyle: 'cloud', cloudIntensity: 4 });
  assert.equal(calloutCloudIntensity(callout), 4);
  assert.equal(calloutCloudIntensity(makeCallout({ lineStyle: 'dashed' })), null);
  assert.equal(calloutLineDashArray('cloud'), null, 'the leader stays a solid straight line');
  const standIn = calloutBoxCloudStandIn(callout, { x: 10, y: 20, width: 120, height: 40 }, {
    stroke: '#1e293b', strokeWidth: 1.4, fill: colorWithAlpha('#ffffff', 0.4),
  });
  assert.equal(standIn.fill, 'rgba(255, 255, 255, 0.4)');
  const twin = { ...standIn, id: 'x' };
  assert.deepEqual(resolveCloudAnnotationGeometry(standIn).outlineRuns, resolveCloudAnnotationGeometry(twin).outlineRuns);
});

test('the toolbar restyle: text box and callout take Cloud and its bump size as one change', () => {
  const tb = textbox({ data: {} });
  assert.equal(restyleCapabilities(tb).cloud, true);
  const clouded = applyRestyleChange(tb, { kind: 'lineStyle', style: 'cloud', cloudIntensity: 5 });
  assert.equal(clouded.data.pdfCloudIntensity, 5);
  assert.equal(readRestyleStyle(clouded).lineStyle, 'cloud');
  assert.equal(applyRestyleChange(clouded, { kind: 'cloudIntensity', cloudIntensity: 7 }).data.pdfCloudIntensity, 7);
  assert.equal(applyRestyleChange(clouded, { kind: 'lineStyle', style: 'solid' }).data.pdfCloudIntensity, null);

  const callout = makeCallout();
  assert.deepEqual(calloutRestylePatch(callout, { kind: 'lineStyle', style: 'cloud', cloudIntensity: 3 }), { lineStyle: 'cloud', cloudIntensity: 3 });
  const cloudCallout = makeCallout({ lineStyle: 'cloud', cloudIntensity: 3 });
  assert.equal(readCalloutRestyleStyle(cloudCallout).lineStyle, 'cloud');
  assert.equal(readCalloutRestyleStyle(cloudCallout).cloudIntensity, 3);
  assert.deepEqual(calloutRestylePatch(cloudCallout, { kind: 'cloudIntensity', cloudIntensity: 6 }), { cloudIntensity: 6 });
  assert.equal(calloutRestylePatch(cloudCallout, { kind: 'cloudIntensity', cloudIntensity: 3 }), null, 'no change, no write');
  assert.equal(calloutRestylePatch(makeCallout(), { kind: 'cloudIntensity', cloudIntensity: 6 }), null, 'a plain callout has no bump');
});

test('a new text box drawn on Cloud is born clouded', () => {
  const json = buildNewTextCommitJSON({
    text: 'hi', left: 1, top: 2, innerWrapWidth: 100, naturalInnerHeight: 20, cloudIntensity: 4,
  });
  assert.equal(json.data.pdfCloudIntensity, 4);
  const plain = buildNewTextCommitJSON({ text: 'hi', left: 1, top: 2, innerWrapWidth: 100, naturalInnerHeight: 20 });
  assert.equal(plain.data.pdfCloudIntensity, undefined);
});

test('the bridge keeps a callout clouded through the group fallback reader', () => {
  const callout = makeCallout({ lineStyle: 'cloud', cloudIntensity: 5 });
  const projected = calloutToAnnotationObject(callout, { width: 600, height: 800 });
  const box = projected.objects.find((child) => child?.data?.calloutPart === 'textBox');
  assert.equal(box.data.calloutCloudIntensity, 5);
  assert.equal(box.data.pdfCloudIntensity, undefined, 'the projection child is never itself a clouded text box');
  for (const part of ['line1', 'line2']) {
    const line = projected.objects.find((child) => child?.data?.calloutPart === part);
    assert.equal(line.strokeDashArray, undefined, `${part} stays straight`);
  }
  const { data, ...withoutLegacy } = projected;
  const back = annotationObjectToCallout(
    { ...withoutLegacy, data: { ...data, legacyCallout: undefined } },
    { width: 600, height: 800 },
  );
  assert.equal(back.style.lineStyle, 'cloud');
  assert.equal(back.style.cloudIntensity, 5);
});

// A recording 2D context: every call is logged; no scratch layer is offered,
// so clouds stroke inline (the painter's documented fallback).
const recorder = () => {
  const calls = [];
  const target = {};
  const ctx = new Proxy(target, {
    get(obj, key) {
      if (key in obj) return obj[key];
      return (...args) => {
        calls.push([key, ...args]);
        if (key === 'measureText') {
          return { width: String(args[0] || '').length * 6, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3 };
        }
        return undefined;
      };
    },
    set(obj, key, value) { obj[key] = value; calls.push([`=${String(key)}`, value]); return true; },
  });
  return { ctx, calls };
};
const count = (calls, name) => calls.filter(([key]) => key === name).length;

test('canvas painter: a clouded text box strokes the same crowns as the clouded rect, and no box rect', () => {
  const tb = textbox();
  const box = recorder();
  drawAnnotationObject(box.ctx, tb, 1);
  const rect = recorder();
  drawAnnotationObject(rect.ctx, rectTwin(tb), 1);
  const curves = (calls) => calls.filter(([key]) => key === 'bezierCurveTo').map((call) => call.slice(1));
  assert.ok(curves(box.calls).length > 8, 'the border is scallops');
  assert.deepEqual(curves(box.calls), curves(rect.calls), 'same crowns as the clouded rectangle');
  assert.equal(count(box.calls, 'strokeRect'), 0, 'no straight box border under the cloud');

  const plain = recorder();
  drawAnnotationObject(plain.ctx, textbox({ data: {} }), 1);
  assert.equal(count(plain.calls, 'strokeRect'), 1, 'an unclouded text box keeps its plain border');
  assert.equal(count(plain.calls, 'bezierCurveTo'), 0);
});

test('canvas painter: a clouded callout clouds its box; leaders stay straight and undashed', () => {
  const paint = (callout) => {
    const { ctx, calls } = recorder();
    paintAnnotationCanvas(ctx, {
      canvasWidth: 600, canvasHeight: 800, drawScale: 1, drawScaleY: 1, displayScale: 1,
      pageWidth: 600, pageHeight: 800, objects: [], callouts: [callout],
    });
    return calls;
  };
  const cloudy = paint(makeCallout({ lineStyle: 'cloud', cloudIntensity: 3 }));
  assert.ok(count(cloudy, 'bezierCurveTo') > 8, 'the box is scallops');
  assert.equal(count(cloudy, 'strokeRect'), 0, 'no straight box border');
  assert.ok(count(cloudy, 'lineTo') >= 2, 'the leader is straight segments');
  const dashes = cloudy.filter(([key]) => key === 'setLineDash').map(([, dash]) => dash);
  assert.ok(dashes.every((dash) => Array.isArray(dash) && dash.length === 0), 'nothing is dashed');
  const plain = paint(makeCallout());
  assert.equal(count(plain, 'bezierCurveTo'), 0);
  assert.equal(count(plain, 'strokeRect'), 1);
});

// ---------------------------------------------------------------------------
// PDF export + print
// ---------------------------------------------------------------------------

const PAGE_SIZES = { 1: { width: 600, height: 800 } };
async function pdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  const bytes = await doc.save();
  return { name: 'w43.pdf', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}
const decode = (stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());

// Every cloud form (XObject whose name starts CloudAP) placed on page 1,
// decoded, in placement order.
async function printedCloudForms(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const xobjects = page.node.Resources()?.lookup(PDFName.of('XObject'));
  const forms = [];
  if (xobjects instanceof PDFDict) {
    for (const [name, ref] of xobjects.entries()) {
      if (!name.decodeText().startsWith('CloudAP')) continue;
      const stream = doc.context.lookup(ref);
      if (stream instanceof PDFRawStream) forms.push(decode(stream));
    }
  }
  const contents = doc.context.lookup(page.node.get(PDFName.of('Contents')));
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  const content = streams.filter((s) => s instanceof PDFRawStream).map(decode).join('\n');
  return { forms, content };
}

test('print: a clouded text box prints the SAME cloud form as the clouded rectangle of its box', async () => {
  const tb = textbox();
  const printed = await printedCloudForms(await savePDFWithFlattenedRegularAnnotationsForPrint(
    await pdfFile(), { 1: { objects: [tb] } }, PAGE_SIZES, { returnBytes: true },
  ));
  const rect = await printedCloudForms(await savePDFWithFlattenedRegularAnnotationsForPrint(
    await pdfFile(), { 1: { objects: [rectTwin(tb)] } }, PAGE_SIZES, { returnBytes: true },
  ));
  assert.equal(printed.forms.length, 1);
  assert.equal(rect.forms.length, 1);
  assert.equal(printed.forms[0], rect.forms[0], 'byte-identical cloud appearance');
  assert.ok(/ c\b/.test(printed.forms[0]), 'the form paints curves');
});

test('print: a clouded callout clouds the box only; its leader prints as straight, undashed lines', async () => {
  const printed = await printedCloudForms(await savePDFWithFlattenedRegularAnnotationsForPrint(
    await pdfFile(), {}, PAGE_SIZES, { returnBytes: true, callouts: [makeCallout({ lineStyle: 'cloud', cloudIntensity: 3 })] },
  ));
  assert.equal(printed.forms.length, 1, 'one cloud: the box');
  assert.ok(!/\[\s*\d[\d\s.]*\]\s+[\d.]+\s+d\b/.test(printed.content), 'no dash anywhere in the callout');
  const plain = await printedCloudForms(await savePDFWithFlattenedRegularAnnotationsForPrint(
    await pdfFile(), {}, PAGE_SIZES, { returnBytes: true, callouts: [makeCallout()] },
  ));
  assert.equal(plain.forms.length, 0);
});

// 2026-10-04 (test-reliability pass): both exports below build a FILLED
// cloud, whose stroke band runs under a wall-clock budget; see
// tests/helpers/cloudBandBudgetClock.mjs for why the clock is held still.
test('print: the callout box cloud is the one the SCREEN draws (same box, width, fill and bump)', async () => {
  const callout = makeCallout({ lineStyle: 'cloud', cloudIntensity: 3, fillColor: '#fde68a', fillOpacity: 0.5 });
  const W = 600; const H = 800;
  // renderCallout's box: the stored box plus fontSize*0.35 descender room,
  // border max(1, 0.7 x thickness), fill at its own opacity.
  const screenBox = {
    x: callout.textBoxPosition.x * W,
    y: callout.textBoxPosition.y * H,
    width: callout.textBoxWidth * W,
    height: callout.textBoxHeight * H + callout.style.fontSize * 0.35,
  };
  const screen = calloutBoxCloudStandIn(callout, screenBox, {
    stroke: callout.style.borderColor,
    strokeWidth: Math.max(1, callout.style.lineThickness * 0.7),
    fill: colorWithAlpha(callout.style.fillColor, callout.style.fillOpacity),
    opacity: 1,
  });
  const printed = await printedCloudForms(await withCloudBandBudgetHeld(async () => savePDFWithFlattenedRegularAnnotationsForPrint(
    await pdfFile(), {}, PAGE_SIZES, { returnBytes: true, callouts: [callout] },
  )));
  const twin = await printedCloudForms(await withCloudBandBudgetHeld(async () => savePDFWithFlattenedRegularAnnotationsForPrint(
    await pdfFile(), { 1: { objects: [screen] } }, PAGE_SIZES, { returnBytes: true },
  )));
  assert.equal(printed.forms.length, 1);
  assert.equal(printed.forms[0], twin.forms[0], 'print clouds the same box the screen clouds');
});

async function exportedDicts(annotationsByPage, options = {}) {
  const bytes = await savePDFWithAnnotationsPdfLib(await pdfFile(), annotationsByPage, PAGE_SIZES, null, {
    returnBytes: true, ...options,
  });
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  return { doc, dicts: annots ? annots.asArray().map((ref) => doc.context.lookup(ref)) : [] };
}

const subtype = (dict) => dict.get(PDFName.of('Subtype'))?.decodeText?.() || String(dict.get(PDFName.of('Subtype')));
const numbers = (arr) => arr.asArray().map((n) => n.asNumber());

test('export: a clouded text box carries /BE /S /C and an appearance that holds its crowns', async () => {
  const tb = textbox();
  const { doc, dicts } = await exportedDicts({ 1: { objects: [tb] } });
  const freeText = dicts.find((dict) => subtype(dict) === '/FreeText' || subtype(dict) === 'FreeText');
  assert.ok(freeText, 'the text box exports as FreeText');
  const be = freeText.lookup(PDFName.of('BE'));
  assert.ok(be, '/BE present');
  assert.equal(String(be.get(PDFName.of('S'))), '/C');
  assert.equal(be.get(PDFName.of('I')).asNumber(), 3);
  const ap = freeText.lookup(PDFName.of('AP'));
  assert.ok(ap, 'the text box ships an appearance');
  const normal = doc.context.lookup(ap.get(PDFName.of('N')));
  const xobjects = normal.dict.lookup(PDFName.of('Resources'))?.lookup(PDFName.of('XObject'));
  assert.ok(xobjects && [...xobjects.keys()].some((key) => key.decodeText().startsWith('CloudAP')), 'the appearance draws the cloud form');
  // /Rect (y-up) grew past the drawn box to hold the scallops on every side.
  const [x0, y0, x1, y1] = numbers(freeText.lookup(PDFName.of('Rect')));
  assert.ok(x0 < tb.left && x1 > tb.left + tb.width, `x ${x0}..${x1}`);
  assert.ok(y0 < 800 - (tb.top + tb.height) && y1 > 800 - tb.top, `y ${y0}..${y1}`);

  const plain = await exportedDicts({ 1: { objects: [textbox({ data: {} })] } });
  const plainFreeText = plain.dicts.find((dict) => /FreeText/.test(subtype(dict)));
  assert.equal(plainFreeText.get(PDFName.of('BE')), undefined, 'a plain text box has no /BE');
});

test('export: a clouded callout keeps its leader as plain Line pieces and clouds the text part', async () => {
  const { doc, dicts } = await exportedDicts({}, { callouts: [makeCallout({ lineStyle: 'cloud', cloudIntensity: 3 })] });
  const lines = dicts.filter((dict) => /Line/.test(subtype(dict)));
  assert.ok(lines.length >= 2);
  for (const line of lines) assert.equal(line.get(PDFName.of('BS')), undefined, 'no dashed border style on the leader');
  const text = dicts.find((dict) => /FreeText/.test(subtype(dict)));
  const normal = doc.context.lookup(text.lookup(PDFName.of('AP')).get(PDFName.of('N')));
  const xobjects = normal.dict.lookup(PDFName.of('Resources'))?.lookup(PDFName.of('XObject'));
  assert.ok(xobjects && [...xobjects.keys()].some((key) => key.decodeText().startsWith('CloudAP')), 'the text part draws the box cloud');
});

test('every screen path draws the box cloud through the shared stand-ins (source contract)', () => {
  const svg = readFileSync(new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url), 'utf8');
  const painter = readFileSync(new URL('../src/utils/annotationCanvasPainter.js', import.meta.url), 'utf8');
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  for (const [label, source] of [['svg', svg], ['painter', painter]]) {
    assert.match(source, /textboxCloudStandIn\(/, `${label}: text box border`);
    assert.match(source, /calloutBoxCloudStandIn\(/, `${label}: callout box`);
  }
  // The box is swapped for the cloud; the plain border is skipped when it is.
  assert.match(svg, /!cloudBorderGeometry && obj\.strokeWidth > 0 && obj\.stroke/);
  assert.match(svg, /stroke=\{boxCloudGeometry \? 'none' : lineColor\}/);
  // Live creation preview carries the armed bump size.
  assert.match(layer, /liveTextEditBounds\.cloudIntensity != null/);
});

test('export -> re-import: a clouded text box and a clouded callout come back clouded with their bump size', async () => {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { importAnnotationsFromPdf } = await import('../src/utils/pdfAnnotationImporter.js');
  const originalWindow = globalThis.window;
  globalThis.window = {};
  let bytes;
  try {
    bytes = await savePDFWithAnnotationsPdfLib(await pdfFile(), { 1: { objects: [textbox()] } }, PAGE_SIZES, null, {
      returnBytes: true, actionType: 'pdf-export', documentId: 'w43-roundtrip',
      callouts: [makeCallout({ lineStyle: 'cloud', cloudIntensity: 4 })],
    });
  } finally {
    globalThis.window = originalWindow;
  }
  const data = bytes instanceof Uint8Array ? bytes.slice() : bytes;
  const task = pdfjsLib.getDocument({ data, disableWorker: true, verbosity: pdfjsLib.VerbosityLevel.ERRORS });
  const pdfDoc = await task.promise;
  try {
    const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
    const objects = imported.annotationsByPage[1]?.objects || [];
    const tb = objects.find((obj) => String(obj.type).toLowerCase() === 'textbox' && obj.data?.type !== 'callout');
    assert.ok(tb, 'the text box comes back');
    assert.equal(tb.data?.pdfCloudIntensity, 3, 'the text box keeps its cloud and bump size');
    const callouts = imported.calloutsByPage?.[1] || [];
    assert.ok(callouts.length >= 1, 'the callout comes back');
    assert.equal(callouts[0].style?.lineStyle, 'cloud');
    assert.equal(callouts[0].style?.cloudIntensity, 4);
  } finally {
    await task.destroy();
  }
});
