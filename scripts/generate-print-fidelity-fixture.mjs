import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PDFDocument,
  PDFName,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', 'debug', 'fixtures');
const pdfPath = join(fixtureDir, 'print-fidelity.pdf');
const manifestPath = join(fixtureDir, 'print-fidelity.manifest.json');
const PAGE = { width: 612, height: 792 };

const pathObject = (id, path, overrides = {}) => ({
  id, type: 'path', left: 0, top: 0, pathOffset: { x: 0, y: 0 },
  scaleX: 1, scaleY: 1, angle: 0, stroke: '#8b5cf6', strokeWidth: 5,
  fill: 'transparent', opacity: 1, strokeLineCap: 'round', strokeLineJoin: 'round',
  path, ...overrides,
});
const quad = (left, top, right, bottom) => ({
  x1: left, y1: top, x2: right, y2: top,
  x3: left, y3: bottom, x4: right, y4: bottom,
});
const markup = (id, markupType, bounds, color, opacity = 1) => ({
  id, type: 'group', fill: color, stroke: color, opacity,
  data: { type: 'text-markup', markupType, overlapMode: 'layered', lineWidth: 1.2, quads: [quad(...bounds)] },
});
const region = (id, type, page, bounds, checks = ['bounds', 'colour'], tolerance) => ({
  id, type, page, bounds, checks, ...(tolerance ? { tolerance } : {}),
});
const stampAppearanceSpec = {
  width: 130,
  height: 60,
  color: [1, 0.2, 0.2],
  border: { inset: 2, width: 3 },
  check: { width: 8, points: [[20, 30], [45, 12], [108, 48]] },
};

const pdf = await PDFDocument.create();
const fixedDate = new Date('2026-01-01T00:00:00.000Z');
pdf.setCreationDate(fixedDate);
pdf.setModificationDate(fixedDate);
const font = await pdf.embedFont(StandardFonts.Helvetica);
const pageSpecs = [
  ...[0, 90, 180, 270, 0, 0, 0, 0, 0, 0].map((rotation) => ({ ...PAGE, rotation })),
  { width: 792, height: 612, rotation: 0 },
];
const pages = pageSpecs.map(({ width, height, rotation }, index) => {
  const page = pdf.addPage([width, height]);
  if (rotation) page.setRotation({ type: 'degrees', angle: rotation });
  page.drawText(`PRINT FIDELITY PAGE ${index + 1} ROTATION ${rotation}`, {
    x: 28, y: 760, size: 10, font, color: rgb(0.78, 0.78, 0.78),
  });
  return page;
});
pages[4].node.set(PDFName.of('CropBox'), pdf.context.obj([36, 72, 576, 720]));

const addNative = (page, dict) => {
  const ref = pdf.context.register(pdf.context.obj({ Type: 'Annot', P: page.ref, F: 4, ...dict }));
  const annots = page.node.lookup(PDFName.of('Annots')) || pdf.context.obj([]);
  if (!page.node.get(PDFName.of('Annots'))) page.node.set(PDFName.of('Annots'), annots);
  annots.push(ref);
  return ref;
};

const nativeSquare = addNative(pages[0], {
  Subtype: 'Square', Rect: [350, 642, 455, 702], C: [1, 0.08, 0.1], CA: 1,
  Border: [0, 0, 6], BS: { Type: 'Border', W: 6, S: 'S' }, NM: 'native-square',
});
const nativePolygon = addNative(pages[0], {
  Subtype: 'Polygon', Rect: [470, 612, 575, 710], Vertices: [478, 620, 566, 628, 525, 700],
  C: [1, 0.08, 0.1], CA: 1, Border: [0, 0, 5], NM: 'native-polygon',
});
const nativeStrike = addNative(pages[0], {
  Subtype: 'StrikeOut', Rect: [340, 542, 500, 566], QuadPoints: [340, 566, 500, 566, 340, 542, 500, 542],
  C: [0.1, 0.8, 0.25], CA: 1, NM: 'native-green-strike', Contents: 'green strike',
});
const nativeInk = addNative(pages[2], {
  Subtype: 'Ink', Rect: [330, 670, 560, 722], InkList: [[335, 680, 390, 715, 455, 678, 550, 705]],
  C: [0.05, 0.45, 0.85], CA: 1, Border: [0, 0, 4], NM: 'native-ink',
});
const nativeCircle = addNative(pages[2], {
  Subtype: 'Circle', Rect: [350, 587, 450, 652], C: [0.05, 0.65, 0.5], IC: [0.8, 0.98, 0.92],
  CA: 1, Border: [0, 0, 3], NM: 'native-circle',
});
const nativeFreeText = addNative(pages[2], {
  Subtype: 'FreeText', Rect: [330, 512, 560, 562], C: [0.45, 0.2, 0.9],
  Contents: 'NATIVE FREE TEXT', DA: '/Times 18 Tf 0.45 0.2 0.9 rg', NM: 'native-free-text',
});
const nativeHighlight = addNative(pages[2], {
  Subtype: 'Highlight', Rect: [330, 447, 560, 477], QuadPoints: [330, 477, 560, 477, 330, 447, 560, 447],
  C: [1, 0.75, 0.1], CA: 0.45, NM: 'native-highlight',
});
const nativeCloud = addNative(pages[2], {
  Subtype: 'Square', Rect: [340, 337, 500, 407], C: [1, 0.3, 0.45], CA: 0.36,
  Border: [0, 0, 1], BS: { Type: 'Border', W: 1, S: 'S' }, BE: { S: 'C', I: 2 }, NM: 'native-cloud',
});
const nativeArrow = addNative(pages[2], {
  Subtype: 'Line', Rect: [330, 235, 560, 302], L: [340, 247, 550, 292], LE: ['None', 'ClosedArrow'],
  C: [0.95, 0.35, 0.1], CA: 1, Border: [0, 0, 4], NM: 'native-arrow',
});
const stampAppearance = pdf.context.register(pdf.context.flateStream(
  [
    'q',
    `${stampAppearanceSpec.color.join(' ')} RG`,
    `${stampAppearanceSpec.border.width} w`,
    `${stampAppearanceSpec.border.inset} ${stampAppearanceSpec.border.inset} ${stampAppearanceSpec.width - 2 * stampAppearanceSpec.border.inset} ${stampAppearanceSpec.height - 2 * stampAppearanceSpec.border.inset} re S`,
    `${stampAppearanceSpec.check.width} w`,
    `${stampAppearanceSpec.check.points[0].join(' ')} m`,
    ...stampAppearanceSpec.check.points.slice(1).map((point) => `${point.join(' ')} l`),
    'S',
    'Q',
  ].join('\n'),
  { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, stampAppearanceSpec.width, stampAppearanceSpec.height], Resources: {} },
));
addNative(pages[7], { Subtype: 'Stamp', Rect: [120, 500, 120 + stampAppearanceSpec.width, 500 + stampAppearanceSpec.height], Rotate: 90, Name: 'Approved', NM: 'native-stamp', AP: { N: stampAppearance } });
addNative(pages[6], {
  Subtype: 'Redact', Rect: [100, 442, 320, 492],
  QuadPoints: [100, 492, 320, 492, 100, 442, 320, 442],
  C: [0.94, 0.12, 0.12], CA: 1, Border: [0, 0, 2], NM: 'native-redaction-unapplied',
});

pages[9].drawText('PALE HIGHLIGHT TEXT', { x: 50, y: 382, size: 16, font, color: rgb(0.08, 0.08, 0.08) });
pages[9].drawText('LINK WITHOUT A BOX', { x: 50, y: 520, size: 14, font, color: rgb(0.08, 0.08, 0.08) });
const deletedPrintSquare = addNative(pages[9], {
  Subtype: 'Square', Rect: [50, 650, 150, 710], C: [0.9, 0.1, 0.15],
  Border: [0, 0, 5], NM: 'deleted-print-square',
});
addNative(pages[9], {
  Subtype: 'Square', Rect: [190, 650, 290, 710], C: [0.9, 0.1, 0.8],
  Border: [0, 0, 8], NM: 'hidden-print-square', F: 6,
});
const erasedPrintInk = addNative(pages[9], {
  Subtype: 'Ink', Rect: [330, 650, 550, 710],
  InkList: [[335, 680, 390, 700, 455, 670, 545, 695]],
  C: [0.05, 0.4, 0.85], Border: [0, 0, 8], NM: 'erased-print-ink',
});
const nativeLink = addNative(pages[9], {
  Subtype: 'Link', Rect: [48, 510, 245, 540], Border: [0, 0, 2], C: [0.1, 0.3, 0.9],
  A: { S: 'URI', URI: 'https://example.com' }, NM: 'link-no-box',
});

// Real sticky note on the landscape page so the runtime import (which replaces
// seeded imported objects with what it re-imports) keeps it on screen.
const nativeStickyNote = addNative(pages[10], {
  Subtype: 'Text', Rect: [100, 268, 124, 292], C: [1, 0.85, 0.2], Name: 'Comment',
  Contents: 'Print glyph check', NM: 'native-sticky-note',
});

// Imported translucent multiply highlighter (wide Ink, /CA 0.35): the screen
// shows a pale wash and print must match, not a solid bar.
const nativeTranslucentInk = addNative(pages[9], {
  Subtype: 'Ink', Rect: [40, 90, 300, 130], InkList: [[50, 110, 290, 110]],
  C: [1, 0.85, 0.1], CA: 0.35, Border: [0, 0, 14], NM: 'native-translucent-ink',
});

const form = pdf.getForm();
const checked = form.createCheckBox('fidelity.checked');
checked.addToPage(pages[0], { x: 350, y: 475, width: 24, height: 24 });
checked.check();
const pageOneAnnots = pages[0].node.lookup(PDFName.of('Annots'));
const checkedRef = pageOneAnnots.get(pageOneAnnots.size() - 1);
const textField = form.createTextField('fidelity.text');
textField.setText('BLUE BORDER');
textField.addToPage(pages[0], { x: 395, y: 470, width: 150, height: 30, font });
const textRef = pageOneAnnots.get(pageOneAnnots.size() - 1);
const multilineField = form.createTextField('fidelity.multiline');
multilineField.enableMultiline();
multilineField.setText('First line wraps within the green field.\nSecond line stays inside.');
multilineField.addToPage(pages[9], { x: 300, y: 500, width: 220, height: 72, font });
multilineField.setFontSize(10);
const pageTenAnnots = pages[9].node.lookup(PDFName.of('Annots'));
const multilineRef = pageTenAnnots.get(pageTenAnnots.size() - 1);
const multilineWidget = pdf.context.lookup(multilineRef);
multilineWidget.set(PDFName.of('F'), pdf.context.obj(4));
multilineWidget.set(PDFName.of('MK'), pdf.context.obj({ BG: [0.92, 1, 0.92], BC: [0.1, 0.6, 0.2] }));
multilineWidget.set(PDFName.of('BS'), pdf.context.obj({ W: 2, S: 'S' }));

const imported = [
  {
    id: 'imported-native-square', type: 'rect', left: 350, top: 90, width: 105, height: 60,
    stroke: 'rgba(255,80,100,0.36)', fill: 'transparent', strokeWidth: 1, opacity: 1,
    isPdfImported: true, pdfAnnotationId: `${nativeSquare.objectNumber}R`, pdfAnnotationType: 'Square',
  },
  {
    id: 'imported-native-polygon', type: 'polygon', left: 470, top: 82,
    points: [{ x: 8, y: 90 }, { x: 96, y: 82 }, { x: 55, y: 10 }],
    stroke: 'rgba(255,80,100,0.36)', fill: 'transparent', strokeWidth: 1, opacity: 1,
    isPdfImported: true, pdfAnnotationId: `${nativePolygon.objectNumber}R`, pdfAnnotationType: 'Polygon',
  },
  {
    ...markup('imported-green-strike', 'strikeout', [340, 226, 500, 250], '#19cc40'),
    isPdfImported: true, pdfAnnotationId: `${nativeStrike.objectNumber}R`, pdfAnnotationType: 'StrikeOut',
  },
  { type: 'form-field', data: { type: 'form-field', fieldId: `${checkedRef.objectNumber}R`, fieldName: 'fidelity.checked', fieldType: 'Btn', value: true } },
  { type: 'form-field', data: { type: 'form-field', fieldId: `${textRef.objectNumber}R`, fieldName: 'fidelity.text', fieldType: 'Tx', value: 'BLUE BORDER' } },
];

const stampProxyPng = await sharp(Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${stampAppearanceSpec.width * 2}" height="${stampAppearanceSpec.height * 2}" viewBox="0 0 ${stampAppearanceSpec.width} ${stampAppearanceSpec.height}">`
  + `<rect x="${stampAppearanceSpec.border.inset}" y="${stampAppearanceSpec.border.inset}" width="${stampAppearanceSpec.width - 2 * stampAppearanceSpec.border.inset}" height="${stampAppearanceSpec.height - 2 * stampAppearanceSpec.border.inset}" fill="none" stroke="rgb(${stampAppearanceSpec.color.map((channel) => channel * 255).join(' ')})" stroke-width="${stampAppearanceSpec.border.width}"/>`
  + `<path d="M${stampAppearanceSpec.check.points.map((point) => point.join(' ')).join(' L')}" fill="none" stroke="rgb(${stampAppearanceSpec.color.map((channel) => channel * 255).join(' ')})" stroke-width="${stampAppearanceSpec.check.width}"/>`
  + '</svg>',
)).png().toBuffer();
const stampProxyDataUrl = `data:image/png;base64,${stampProxyPng.toString('base64')}`;

const fixtureCallout = {
  id: 'callout-1', type: 'callout', data: { type: 'callout', id: 'callout-1' }, pageNumber: 9,
  text: 'Callout text',
  arrowTip: { x: 430 / 612, y: 350 / 792 },
  knee: { x: 350 / 612, y: 300 / 792 },
  textBox: { left: 80 / 612, top: 100 / 792, width: 180 / 612, height: 72 / 792 },
  style: { lineColor: '#be123c', borderColor: '#be123c', lineThickness: 3, backgroundColor: '#fff1f2', fontColor: '#881337', fontSize: 16, bold: true, arrowheadStyle: 'none' },
};

const annotationsByPage = {
  1: { width: 612, height: 792, objects: [
    pathObject('pen-fresh', [['M', 45, 95], ['Q', 85, 65, 125, 100], ['L', 165, 82]]),
    pathObject('pen-edited', [['M', 0, 0], ['C', 25, -20, 55, 30, 82, 4]], { left: 70, top: 170, pathOffset: { x: 0, y: 0 }, scaleX: 1.35, scaleY: 0.8, angle: 18, stroke: '#2563eb' }),
    pathObject('pen-erased', [['M', 210, 62], ['L', 320, 62], ['L', 320, 105], ['L', 210, 105], ['Z'], ['M', 252, 72], ['L', 278, 72], ['L', 278, 96], ['L', 252, 96], ['Z']], { stroke: 'none', strokeWidth: 0, fill: '#dc2626', fillRule: 'evenodd', paperEraserGeometry: 'v1' }),
    pathObject('highlighter', [['M', 40, 255], ['L', 180, 255]], { stroke: 'rgba(250,204,21,0.55)', strokeWidth: 18, globalCompositeOperation: 'multiply' }),
    { id: 'rectangle', type: 'rect', left: 40, top: 310, width: 100, height: 62, angle: 12, stroke: '#ef4444', strokeWidth: 4, fill: '#fee2e2' },
    { id: 'ellipse', type: 'ellipse', left: 175, top: 305, rx: 54, ry: 30, angle: -18, stroke: '#0ea5e9', strokeWidth: 3, fill: 'rgba(14,165,233,0.20)' },
    { id: 'line', type: 'line', x1: 40, y1: 420, x2: 150, y2: 455, stroke: '#16a34a', strokeWidth: 4 },
    { id: 'arrow', type: 'line', x1: 180, y1: 450, x2: 300, y2: 405, stroke: '#7c3aed', strokeWidth: 4, lineEnding2: 'ClosedArrow', tool: 'arrow' },
    { id: 'polygon', type: 'polygon', left: 45, top: 510, angle: 15, scaleX: 1.15, scaleY: 0.9, points: [{ x: 0, y: 45 }, { x: 55, y: 0 }, { x: 110, y: 48 }, { x: 70, y: 90 }], stroke: '#f97316', strokeWidth: 4, fill: 'rgba(249,115,22,0.22)' },
    { id: 'polyline', type: 'polyline', left: 185, top: 520, points: [{ x: 0, y: 0 }, { x: 35, y: 55 }, { x: 78, y: 8 }, { x: 122, y: 62 }], stroke: '#0891b2', strokeWidth: 4, fill: 'none' },
    ...imported,
  ] },
  2: { width: 792, height: 612, objects: [
    { id: 'textbox-format', type: 'textbox', left: 60, top: 65, width: 230, height: 80, text: 'FIRST WRAPPED LINE\nSECOND WRAPPED LINE\nTHIRD WRAPPED LINE', fontFamily: 'Helvetica', fontSize: 16, lineHeight: 1, fontWeight: 'bold', fill: '#7c3aed', backgroundColor: '#fef3c7', stroke: '#7c3aed', strokeWidth: 3, angle: 8 },
    { id: 'counter', type: 'circle', left: 350, top: 90, radius: 22, fill: '#ef4444', data: { id: 'counter', type: 'counter', annotationType: 'counter', number: '12', numberColor: '#ffffff', pointerAngle: 225, seriesId: 'print-fidelity-series', seriesStart: 1, createdAt: 1 } },
    { id: 'space-shape', type: 'rect', left: 60, top: 220, width: 150, height: 70, stroke: '#2563eb', strokeWidth: 3, fill: '#dbeafe', spaceId: 'space-1' },
    { id: 'region-shape', type: 'ellipse', left: 270, top: 220, rx: 70, ry: 35, stroke: '#16a34a', strokeWidth: 3, fill: 'rgba(22,163,74,0.12)' },
  ] },
  // Page 3 is /Rotate 180: imported natives are seeded where the viewer shows
  // them after rotation (x' = 612 - x - w, y' = 792 - y - h of the PDF rect).
  3: { width: 612, height: 792, objects: [
    markup('highlight-default', 'highlight', [55, 90, 260, 116], '#f4d35e', 0.35),
    markup('underline-custom', 'underline', [55, 155, 260, 181], '#2563eb'),
    { id: 'link', type: 'group', fill: '#2563eb', stroke: '#2563eb', opacity: 1, data: { type: 'text-markup', markupType: 'link', quads: [quad(55, 350, 260, 376)], url: 'https://example.com' } },
    pathObject('imported-native-ink', [['M', 277, 704], ['C', 222, 739, 157, 702, 62, 729]], { stroke: '#0d73d9', strokeWidth: 4, isPdfImported: true, pdfAnnotationId: `${nativeInk.objectNumber}R`, pdfAnnotationType: 'Ink' }),
    { id: 'imported-native-circle', type: 'ellipse', left: 162, top: 587, rx: 50, ry: 32.5, stroke: '#0da67f', strokeWidth: 3, fill: 'rgba(204,250,235,0.55)', isPdfImported: true, pdfAnnotationId: `${nativeCircle.objectNumber}R`, pdfAnnotationType: 'Circle' },
    { id: 'imported-native-free-text', type: 'textbox', left: 52, top: 512, width: 230, height: 50, text: 'NATIVE FREE TEXT', fontFamily: 'Times New Roman', fontSize: 18, fill: '#7333e6', isPdfImported: true, pdfAnnotationId: `${nativeFreeText.objectNumber}R`, pdfAnnotationType: 'FreeText' },
    { ...markup('imported-native-highlight', 'highlight', [52, 447, 282, 477], '#ffbf1a', 0.45), isPdfImported: true, pdfAnnotationId: `${nativeHighlight.objectNumber}R`, pdfAnnotationType: 'Highlight' },
    { id: 'imported-native-cloud', type: 'rect', left: 112, top: 337, width: 160, height: 70, stroke: 'rgba(255,76,115,0.36)', strokeWidth: 1, fill: 'transparent', data: { pdfCloudIntensity: 2 }, isPdfImported: true, pdfAnnotationId: `${nativeCloud.objectNumber}R`, pdfAnnotationType: 'Square' },
    { id: 'imported-native-arrow', type: 'line', x1: 272, y1: 292, x2: 62, y2: 247, stroke: '#f2591a', strokeWidth: 4, lineEnding2: 'ClosedArrow', tool: 'arrow', isPdfImported: true, pdfAnnotationId: `${nativeArrow.objectNumber}R`, pdfAnnotationType: 'Line' },
  ] },
  4: { width: 792, height: 612, objects: [
    pathObject('rotated-page-ink', [['M', 80, 120], ['C', 150, 60, 220, 180, 300, 110]], { stroke: '#db2777', strokeWidth: 7 }),
    { id: 'rotated-page-rect', type: 'rect', left: 90, top: 250, width: 180, height: 90, angle: 27, stroke: '#0f766e', strokeWidth: 5, fill: '#ccfbf1' },
  ] },
  5: { width: 540, height: 648, objects: [
    { id: 'cropbox-offset-rect', type: 'rect', left: 65, top: 90, width: 170, height: 95, stroke: '#9333ea', strokeWidth: 5, fill: '#f3e8ff' },
    markup('cropbox-highlight', 'highlight', [70, 245, 280, 275], '#facc15', 0.4),
  ] },
  7: { width: 612, height: 792, objects: [
    markup('squiggle-custom', 'squiggly', [70, 70, 300, 96], '#dc2626'),
    markup('strike-custom', 'strikeout', [70, 150, 300, 176], '#16a34a'),
  ] },
  8: { width: 612, height: 792, objects: [{
    id: 'native-stamp-proxy', type: 'image', src: stampProxyDataUrl,
    left: 120, top: 232, width: 130, height: 60, scaleX: 1, scaleY: 1,
    opacity: 1, angle: 90, selectable: true, evented: true,
    hasControls: false, hasBorders: true,
    lockMovementX: true, lockMovementY: true,
    lockScalingX: true, lockScalingY: true, lockRotation: true,
    isPdfImported: true, pdfAnnotationId: 'native-stamp', pdfAnnotationType: 'Stamp',
    data: { pdfStampAppearanceRotationBaked: false },
  }] },
  10: { width: 612, height: 792, objects: [
    { id: 'imported-delete-square', type: 'rect', left: 50, top: 82, width: 100, height: 60,
      stroke: '#e61926', strokeWidth: 5, fill: 'transparent', isPdfImported: true,
      pdfAnnotationId: `${deletedPrintSquare.objectNumber}R`, pdfAnnotationType: 'Square' },
    pathObject('imported-erase-ink', [['M', 335, 112], ['C', 390, 92, 455, 122, 545, 97]], {
      stroke: '#0d66d9', strokeWidth: 8, isPdfImported: true,
      pdfAnnotationId: `${erasedPrintInk.objectNumber}R`, pdfAnnotationType: 'Ink',
    }),
    { ...markup('imported-link-no-box', 'link', [48, 252, 245, 282], '#1a4de6'),
      isPdfImported: true, pdfAnnotationId: `${nativeLink.objectNumber}R`, pdfAnnotationType: 'Link' },
    { type: 'form-field', data: { type: 'form-field', fieldId: `${multilineRef.objectNumber}R`,
      fieldName: 'fidelity.multiline', fieldType: 'Tx',
      value: 'First line wraps within the green field.\nSecond line stays inside.' } },
    pathObject('imported-translucent-ink', [['M', 50, 682], ['L', 290, 682]], {
      stroke: '#ffd91a', strokeWidth: 14, opacity: 0.35, globalCompositeOperation: 'multiply',
      isPdfImported: true, pdfAnnotationId: `${nativeTranslucentInk.objectNumber}R`, pdfAnnotationType: 'Ink',
    }),
    pathObject('translucent-multiply-highlighter', [['M', 45, 405], ['L', 245, 405]], {
      stroke: '#facc15', strokeWidth: 22, opacity: 0.35, globalCompositeOperation: 'multiply',
    }),
    pathObject('round-cap-pen', [['M', 60, 500], ['L', 250, 500]], {
      stroke: '#7c3aed', strokeWidth: 20,
    }),
  ] },
  11: { width: 792, height: 612, objects: [
    { id: 'landscape-page', type: 'rect', left: 70, top: 100, width: 650, height: 120,
      stroke: '#0f766e', strokeWidth: 5, fill: '#ccfbf1' },
    // Imported sticky note (/Text): the screen and print draw the note glyph,
    // not a flat square (E2E cosmetic item, batch 7).
    { id: 'imported-sticky-note', type: 'rect', left: 100, top: 320, width: 24, height: 24,
      fill: 'rgba(255, 217, 51, 0.92)', stroke: 'rgba(65, 57, 12, 0.72)', strokeWidth: 1,
      data: { type: 'note', pdfNoteGlyph: 'note', pdfNoteIcon: 'Comment', noteText: 'Print glyph check' },
      isPdfImported: true, pdfAnnotationId: `${nativeStickyNote.objectNumber}R`, pdfAnnotationType: 'Text' },
  ] },
};

const regions = [
  region('pen-fresh', 'pen', 1, [35, 55, 175, 110], ['bounds', 'colour', 'strokeWeight']),
  region('pen-edited', 'pen-edited', 1, [55, 130, 205, 230], ['bounds', 'orientation', 'colour']),
  region('pen-erased', 'pen-erased', 1, [200, 50, 330, 115], ['bounds', 'fillCoverage', 'colour']),
  region('highlighter', 'highlighter', 1, [30, 235, 190, 275], ['bounds', 'colour', 'strokeWeight']),
  region('rectangle', 'rectangle', 1, [25, 290, 160, 395], ['bounds', 'fillCoverage', 'colour', 'strokeWeight']),
  region('ellipse', 'ellipse', 1, [155, 275, 305, 385], ['bounds', 'orientation', 'fillCoverage', 'colour']),
  region('line', 'line', 1, [30, 400, 160, 470], ['bounds', 'colour', 'strokeWeight']),
  region('arrow', 'arrow', 1, [165, 390, 315, 465], ['bounds', 'orientation', 'colour'], { boundsPixels: 6 }),
  region('polygon', 'polygon', 1, [25, 490, 180, 630], ['bounds', 'fillCoverage', 'colour']),
  region('polyline', 'polyline', 1, [170, 500, 330, 610], ['bounds', 'colour', 'strokeWeight']),
  region('imported-native-square', 'native-square', 1, [335, 75, 465, 165], ['bounds', 'colour', 'strokeWeight'], { boundsPixels: 5 }),
  region('imported-native-polygon', 'native-polygon', 1, [465, 65, 590, 180], ['bounds', 'colour', 'strokeWeight']),
  region('imported-green-strike', 'native-strikeout', 1, [325, 210, 515, 265], ['bounds', 'colour']),
  // Widgets print with their own /MK colours, not the screen's blue editing chrome.
  region('form-checkbox', 'form-checkbox', 1, [340, 282, 385, 330], ['textPresence']),
  region('form-text', 'form-text', 1, [385, 280, 555, 335], ['textPresence']),
  // Rotated text: print rotates the glyph origin about the box center like the
  // screen, but glyph placement comes from a font-metric approximation
  // (≤4pt residual, eye-verified identical at print size). 8px on the common
  // grid; the un-rotated / mis-placed failures this exists to catch were 10%+.
  region('textbox-format', 'textbox', 2, [45, 50, 315, 165], ['bounds', 'fillCoverage', 'colour', 'textPresence'], { boundsPixels: 8 }),
  region('counter', 'counter', 2, [320, 55, 405, 150], ['bounds', 'fillCoverage', 'colour', 'textPresence']),
  region('survey-marker', 'survey-marker', 6, [160, 160, 390, 255]),
  region('space-shape', 'space', 2, [45, 205, 225, 310]),
  region('region-shape', 'region', 2, [250, 200, 430, 310]),
  region('callout-1', 'callout', 9, [60, 80, 460, 380], ['bounds', 'colour', 'textPresence']),
  region('highlight-default', 'highlight', 3, [45, 80, 270, 125], ['bounds', 'fillCoverage', 'colour']),
  region('underline-custom', 'underline', 3, [45, 145, 270, 190], ['bounds', 'colour', 'strokeWeight']),
  region('squiggle-custom', 'squiggle', 7, [55, 55, 315, 115], ['bounds', 'colour', 'strokeWeight']),
  region('strike-custom', 'strikethrough', 7, [55, 135, 315, 195], ['bounds', 'colour', 'strokeWeight']),
  region('link', 'link', 3, [45, 340, 270, 385], ['bounds', 'colour']),
  region('redaction-unapplied', 'redaction', 7, [85, 285, 335, 365], ['bounds', 'fillCoverage', 'colour']),
  region('imported-native-ink', 'native-ink', 3, [45, 650, 295, 735], ['bounds', 'colour', 'strokeWeight']),
  region('imported-native-circle', 'native-circle', 3, [147, 572, 277, 667], ['bounds', 'fillCoverage', 'colour', 'strokeWeight']),
  region('imported-native-free-text', 'native-free-text', 3, [37, 497, 297, 577], ['bounds', 'textPresence'], { boundsPixels: 8 }),
  region('imported-native-highlight', 'native-highlight', 3, [37, 432, 297, 492], ['bounds', 'fillCoverage', 'colour']),
  // The page-3 link underline crosses this crop, so the dominant-colour pick is
  // ambiguous (blue vs pale pink) on both sides; bounds carry the check.
  region('imported-native-cloud', 'native-cloud', 3, [92, 317, 292, 427], ['bounds'], { boundsPixels: 6 }),
  region('imported-native-arrow', 'native-arrow', 3, [40, 225, 290, 315], ['bounds', 'orientation', 'colour', 'strokeWeight'], { boundsPixels: 6 }),
  region('rotated-page-ink', 'rotated-ink', 4, [55, 45, 325, 200]),
  region('rotated-page-rect', 'rotated-rect', 4, [55, 205, 310, 390], ['bounds', 'colour'], { boundsPixels: 5 }),
  region('native-stamp', 'native-stamp', 8, [100, 180, 270, 345], ['bounds', 'orientation', 'textPresence']),
  region('cropbox-offset-rect', 'cropbox-rect', 5, [50, 75, 250, 205]),
  region('cropbox-highlight', 'cropbox-highlight', 5, [55, 230, 295, 290]),
  region('deleted-imported-mark', 'deleted-imported-mark', 10, [35, 65, 165, 160], ['bounds', 'colour'], { expectedPrintAbsent: true }),
  region('hidden-native-mark', 'hidden-native-mark', 10, [175, 65, 305, 160], [], { expectedScreenAbsent: true, expectedPrintAbsent: true }),
  region('erased-imported-mark', 'erased-imported-mark', 10, [315, 65, 565, 160], ['bounds', 'colour'], { expectedPrintAbsent: true }),
  // Only the page text paints here on both sides; the point is that no link box appears.
  region('link-no-box', 'link', 10, [35, 235, 260, 295], ['bounds', 'textPresence']),
  region('multiline-form', 'form-text-multiline', 10, [285, 205, 535, 310], ['bounds', 'colour', 'textPresence']),
  region('translucent-multiply-highlighter', 'highlighter', 10, [35, 370, 260, 430], ['bounds', 'fillCoverage', 'colour'], { minPrintLightness: 55 }),
  region('imported-translucent-ink', 'native-ink', 10, [35, 665, 305, 700], ['bounds', 'fillCoverage', 'colour'], { minPrintLightness: 55, boundsPixels: 6 }),
  region('round-cap-pen', 'pen', 10, [35, 475, 275, 525], ['bounds', 'colour', 'strokeWeight']),
  region('landscape-page', 'landscape-page', 11, [50, 80, 740, 240], ['bounds', 'fillCoverage', 'colour']),
  region('imported-sticky-note', 'native-sticky-note', 11, [85, 305, 140, 360], ['bounds', 'fillCoverage', 'colour', 'textPresence'], { boundsPixels: 5 }),
];

await mkdir(fixtureDir, { recursive: true });
const bytes = await pdf.save({ updateFieldAppearances: false });
const manifest = {
  version: 1,
  pdfFile: 'print-fidelity.pdf',
  pdfSize: bytes.byteLength,
  fixedZoom: 1,
  rasterScale: 2,
  pages: pageSpecs.map(({ width, height, rotation }, index) => ({
    page: index + 1,
    rotation,
    width,
    height,
    ...(index === 4 ? { cropBox: [36, 72, 576, 720] } : {}),
    ...(index === 5 ? { requiresSurveyMode: true } : {}),
  })),
  annotationsByPage,
  spaces: [{ id: 'space-1', assignedPages: [{ pageId: 2, wholePageIncluded: false, regions: [{ regionId: 'region-1', shapeType: 'rectangular', coordinates: [250, 200, 430, 200, 430, 310, 250, 310] }] }] }],
  // Real markers keep geometry under `bounds` only — no top-level x/y — so the
  // harness proves the print path reads the shape a saved marker actually has.
  surveyMarkers: { 'survey-marker-1': { annotationId: 'survey-marker-1', pageNumber: 6, moduleId: 'kal436-module', entityId: 'fixture-entity', entityColor: 'rgba(216,168,78,0.55)', bounds: { x: 180, y: 180, width: 190, height: 50 }, color: 'rgba(216,168,78,0.55)' } },
  callouts: [fixtureCallout],
  regions,
};
await writeFile(pdfPath, bytes);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${pdfPath}`);
console.log(`Wrote ${manifestPath}`);
