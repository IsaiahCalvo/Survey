// Nightly 'link-tool': a link mark exports as a real PDF /Link (Drawboard
// writes the same): /BS for the border style, /C the colour, /QuadPoints the
// box, /H /N, /Subj (Hyperlink), and the action - /URI for a website, /GoTo
// a page (/Fit) or an area (/FitR). The border only, never the fill.
//
// The dict is written in the exporters' virtual page frame like /Square;
// the caller's page-frame pass moves /Rect and /QuadPoints. `destinationFor`
// turns a target page (and box) into a /D array in that page's real space.
import { PDFName } from 'pdf-lib';
import { linkExportSpec } from '../../linkTool.js';
import { hexToRgbTriplet, pdfStringOrEmpty, registerAnnotationDict, resolveAnnotationName } from './shared.js';

const fmt = (n) => String(Math.round(n * 1000) / 1000);

/** The /AP /N stream for an upright link: its border in the box (inset by half the width). */
function linkAppearance(pdfDoc, spec) {
  const [x0, y0, x1, y1] = spec.rect;
  const w = x1 - x0;
  const h = y1 - y0;
  const sw = spec.borderWidth;
  if (!(sw > 0) || !(w > 0) || !(h > 0)) return null;
  const [r, g, b] = hexToRgbTriplet(spec.color, '#0066D4');
  const dash = spec.dash ? `[${spec.dash.map(fmt).join(' ')}] 0 d` : '[] 0 d';
  const path = spec.borderStyle === 'U'
    ? `0 ${fmt(sw / 2)} m ${fmt(w)} ${fmt(sw / 2)} l S`
    : `${fmt(sw / 2)} ${fmt(sw / 2)} ${fmt(Math.max(0, w - sw))} ${fmt(Math.max(0, h - sw))} re S`;
  const content = `q ${fmt(r)} ${fmt(g)} ${fmt(b)} RG ${fmt(sw)} w ${dash} ${path} Q`;
  const stream = pdfDoc.context.stream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, w, h],
    Resources: {},
  });
  return pdfDoc.context.register(stream);
}

export function adaptLinkBox(fabricObj, { pdfDoc, page, pageHeight, destinationFor, author = null }) {
  const spec = linkExportSpec(fabricObj, pageHeight);
  if (!spec) return null;
  let action;
  if (spec.action.uri) {
    action = { S: PDFName.of('URI'), URI: pdfStringOrEmpty(spec.action.uri) };
  } else {
    const destination = typeof destinationFor === 'function' ? destinationFor(spec.action.page, spec.action.fitR || null) : null;
    if (!destination) return null;
    action = { S: PDFName.of('GoTo'), D: destination };
  }
  const dict = {
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: spec.rect,
    QuadPoints: spec.quadPoints,
    C: hexToRgbTriplet(spec.color, '#0066D4'),
    Border: [0, 0, spec.borderWidth],
    BS: {
      Type: PDFName.of('Border'),
      S: PDFName.of(spec.borderStyle),
      W: spec.borderWidth,
      ...(spec.dash ? { D: spec.dash } : {}),
    },
    H: PDFName.of('N'),
    Subj: pdfStringOrEmpty('Hyperlink'),
    ...(author ? { T: pdfStringOrEmpty(author) } : {}),
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'link')),
    F: 4,
    P: page.ref,
    A: action,
  };
  // An upright link carries its own drawing so Preview / Quick Look show the
  // border too; a turned one leaves it to the viewer's /BS.
  const turn = (((Number(fabricObj.angle) || 0) % 360) + 360) % 360;
  const upright = turn < 0.01 || turn > 359.99;
  const appearance = upright ? linkAppearance(pdfDoc, spec) : null;
  if (appearance) dict.AP = { N: appearance };
  return registerAnnotationDict(pdfDoc, dict);
}
