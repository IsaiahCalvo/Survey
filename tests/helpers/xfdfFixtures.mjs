// Shared fixtures for the XFDF export tests (KAL-393): a source PDF that
// already holds one native annotation, and one app mark of every kind the
// app can draw, built with the same factories the app uses.
import { createHash } from 'node:crypto';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { createTextMarkupAnnotation } from '../../src/utils/pdfTextMarkup.js';
import { createProductionPaperInk } from '../../src/utils/productionPaperInk.js';

export const PAGE_SIZES = { 1: { width: 300, height: 400 }, 2: { width: 400, height: 300 } };

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function makeSourcePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  doc.addPage([400, 300]);
  // A comment that already lives in the source PDF. The sidecar must not copy it.
  const native = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'Square',
    Rect: [200, 20, 260, 60],
    C: [0, 0, 1],
    NM: PDFString.of('already-in-source'),
  }));
  page.node.set(PDFName.of('Annots'), doc.context.obj([native]));
  doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of('A1B2C3'), PDFHexString.of('D4E5F6')]);
  return doc.save();
}

export const fileFrom = (bytes, name = 'Level 2 plan.pdf') => ({
  name,
  arrayBuffer: async () => bytes.slice().buffer,
});

const quad = (x, y, w, h) => ({ x1: x, y1: y, x2: x + w, y2: y, x3: x, y3: y + h, x4: x + w, y4: y + h });

const markup = (id, markupType, color, y, extra = {}) => createTextMarkupAnnotation({
  id,
  pageNumber: 1,
  selectionGroupId: `${id}-group`,
  markupType,
  selectedText: `${markupType} text`,
  color,
  opacity: markupType === 'highlight' ? 0.4 : 1,
  quads: [quad(20, y, 80, 10)],
  ...extra,
});

// id -> what the XFDF element must be. Colours are the stroke (or markup)
// colour the user picked; the freetext's colour lives in its appearance string.
export const EXPECTED = {
  'rect-1': { element: 'square', page: 0, color: '#E11D48' },
  'circle-1': { element: 'circle', page: 0, color: '#16A34A', interior: '#2563EB' },
  'arrow-1': { element: 'line', page: 0, color: '#123456', tail: 'ClosedArrow' },
  'text-1': { element: 'freetext', page: 0, contents: 'Move <duct> & "cap" — été 東京' },
  'polyline-1': { element: 'polyline', page: 1, color: '#0000FF' },
  'ink-1': { element: 'ink', page: 1, color: '#D11B2D' },
  'hl-1': { element: 'highlight', page: 0, color: '#FFD400', contents: 'highlight text' },
  'hl-uniform': { element: 'highlight', page: 0, color: '#FFD400', contents: 'highlight text' },
  'ul-1': { element: 'underline', page: 0, color: '#FF0000', contents: 'underline text' },
  'so-1': { element: 'strikeout', page: 0, color: '#3D63DC', contents: 'strikeout text' },
  'sq-1': { element: 'squiggly', page: 0, color: '#15803D', contents: 'squiggly text' },
};

export function makeAnnotationsByPage() {
  return {
    1: {
      objects: [
        { id: 'rect-1', type: 'rect', left: 20, top: 20, width: 80, height: 40, stroke: '#e11d48', fill: 'transparent', strokeWidth: 2 },
        { id: 'circle-1', type: 'circle', left: 120, top: 20, radius: 20, stroke: '#16a34a', fill: '#2563eb', strokeWidth: 1 },
        { id: 'arrow-1', type: 'line', left: 0, top: 0, width: 0, height: 0, x1: 20, y1: 100, x2: 150, y2: 160, stroke: '#123456', strokeWidth: 3, lineEnding2: 'ClosedArrow' },
        { id: 'text-1', type: 'textbox', left: 20, top: 200, width: 200, height: 20, text: EXPECTED['text-1'].contents, fill: '#ff0000', fontSize: 12 },
        markup('hl-1', 'highlight', '#ffd400', 300),
        markup('hl-uniform', 'highlight', '#ffd400', 320, { overlapMode: 'uniform' }),
        markup('ul-1', 'underline', '#ff0000', 340),
        markup('so-1', 'strikeout', '#3d63dc', 360),
        markup('sq-1', 'squiggly', '#15803d', 380),
      ],
    },
    2: {
      objects: [
        {
          id: 'polyline-1', type: 'polyline', left: 50, top: 50, width: 100, height: 10,
          points: [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 0 }],
          pathOffset: { x: 50, y: 5 }, stroke: '#0000ff', strokeWidth: 2, fill: 'transparent',
        },
        createProductionPaperInk({
          id: 'ink-1', tool: 'pen', color: '#d11b2d', width: 4,
          points: [{ x: 200, y: 100 }, { x: 240, y: 130 }, { x: 300, y: 120 }],
        }),
      ],
    },
  };
}
