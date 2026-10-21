// Shared fixtures and a small content-stream reader for the tests of tools
// that place pages on sheets (resize, n-up, booklet).
import {
  PDFDocument, PDFName, PDFRawStream, PDFContentStream, PDFDict, PDFArray, PDFNumber, decodePDFRawStream, degrees, rgb,
} from 'pdf-lib';

// pages: [{ size: [w, h], rotate?, crop?: [x, y, w, h], blank?, markup? }].
// Every non-blank page gets a full-crop-box rectangle so it has content.
export async function makePdf(pages) {
  const doc = await PDFDocument.create();
  for (const spec of pages) {
    const page = doc.addPage(spec.size);
    if (spec.crop) page.setCropBox(...spec.crop);
    if (!spec.blank) {
      const box = page.getCropBox();
      page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    }
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
    if (spec.markup) addSquareMarkup(doc, page);
  }
  return doc.save();
}

// A square markup with its own appearance, like one a PDF reader draws.
function addSquareMarkup(doc, page) {
  const { context } = doc;
  const ap = context.register(context.flateStream('1 0 0 RG 2 w 5 5 40 40 re S', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 50],
  }));
  const annot = context.register(context.obj({
    Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 60, 60], AP: { N: ap },
  }));
  page.node.set(PDFName.of('Annots'), context.obj([annot]));
}

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function streamText(stream) {
  if (stream instanceof PDFRawStream) return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  if (stream instanceof PDFContentStream) return new TextDecoder().decode(stream.getUnencodedContents());
  return '';
}

export function contentOf(page) {
  const contents = page.node.Contents();
  if (!contents) return '';
  const list = contents instanceof PDFArray ? contents.asArray().map((r) => page.doc.context.lookup(r)) : [contents];
  return list.map(streamText).join('\n');
}

// Each form drawn on the page: its name, its stream, and the full matrix from
// form space to page space (CTM times the form's own /Matrix).
export function drawnForms(page) {
  const xobjects = page.node.Resources().lookup(PDFName.of('XObject'), PDFDict);
  const tokens = contentOf(page).split(/\s+/).filter(Boolean);
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let nums = [];
  let name = '';
  const out = [];
  for (const t of tokens) {
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) { nums.push(Number(t)); continue; }
    if (t === 'q') stack.push(ctm);
    else if (t === 'Q') ctm = stack.pop();
    else if (t === 'cm') ctm = mul(nums.slice(-6), ctm);
    else if (t === 'Do') {
      const stream = page.doc.context.lookup(xobjects.get(PDFName.of(name)));
      const own = stream.dict.lookup(PDFName.of('Matrix'), PDFArray)?.asArray().map((n) => n.asNumber()) || [1, 0, 0, 1, 0, 0];
      const bbox = stream.dict.lookup(PDFName.of('BBox'), PDFArray).asArray().map((n) => n.asNumber());
      out.push({ name, stream, bbox, matrix: mul(own, ctm) });
    }
    if (t.startsWith('/')) name = t.slice(1);
    nums = [];
  }
  return out;
}

// The page-space rectangle a drawn form's BBox covers.
export function footprint({ bbox, matrix }) {
  const pts = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[0], bbox[3]], [bbox[2], bbox[3]]].map(([x, y]) => apply(matrix, x, y));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
export const num = (v) => (v instanceof PDFNumber ? v.asNumber() : NaN);
