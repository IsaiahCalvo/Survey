// Text-markup adapters: Fabric rect → PDF /Highlight /Underline /Squiggly
// /StrikeOut. All four subtypes share the same quad-point math —
// QuadPoints describe the four corners of each markup region in
// PDF-space. Single-rect inputs produce a single quad, but we still
// emit the array shape the spec requires so multi-line markups can be
// supported in a follow-up without breaking the dict layout.
//
// QuadPoint order follows the Adobe convention used elsewhere in this
// codebase (TopLeft, TopRight, BottomLeft, BottomRight) rather than
// the PDF spec's counter-clockwise order — see the matching block in
// pdfAnnotationsPdfLib.createHighlightAnnotation.

import {
  flipY,
  hexToRgbTriplet,
  pdfStringOrEmpty,
  registerAnnotationDict,
  resolveAnnotationName,
  getFabricFill,
  getFabricStroke,
} from './shared.js';


function buildQuadPointsFromBounds({ left, top, width, height }, pageHeight) {
  const minX = left;
  const maxX = left + width;
  const maxY = flipY(pageHeight, top);
  const minY = flipY(pageHeight, top + height);
  return [
    minX, maxY,  // TopLeft
    maxX, maxY,  // TopRight
    minX, minY,  // BottomLeft
    maxX, minY,  // BottomRight
  ];
}

function buildTextMarkupDict({
  subtype,
  fabricObj,
  pageHeight,
  page,
  colorFallback,
  fallbackPrefix,
  useFill = false,
}) {
  const bounds = {
    left: Number(fabricObj?.left) || 0,
    top: Number(fabricObj?.top) || 0,
    width: Number(fabricObj?.width) || 0,
    height: Number(fabricObj?.height) || 0,
  };
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const storedQuads = Array.isArray(fabricObj?.data?.quads) ? fabricObj.data.quads : [];
  const quadPoints = storedQuads.length > 0
    ? storedQuads.flatMap((quad) => [
        Number(quad.x1), flipY(pageHeight, Number(quad.y1)),
        Number(quad.x2), flipY(pageHeight, Number(quad.y2)),
        Number(quad.x3), flipY(pageHeight, Number(quad.y3)),
        Number(quad.x4), flipY(pageHeight, Number(quad.y4)),
      ])
    : buildQuadPointsFromBounds(bounds, pageHeight);
  const quadXs = quadPoints.filter((_, index) => index % 2 === 0);
  const quadYs = quadPoints.filter((_, index) => index % 2 === 1);
  const minX = Math.min(...quadXs);
  const minY = Math.min(...quadYs);
  const maxX = Math.max(...quadXs);
  const maxY = Math.max(...quadYs);

  const colorSource = useFill
    ? (getFabricFill(fabricObj) || colorFallback)
    : (getFabricStroke(fabricObj, colorFallback) || colorFallback);
  const color = hexToRgbTriplet(colorSource);

  return {
    Type: 'Annot',
    Subtype: subtype,
    Rect: [minX, minY, maxX, maxY],
    QuadPoints: quadPoints,
    C: color,
    Contents: pdfStringOrEmpty(fabricObj?.data?.selectedText || ''),
    CA: Math.max(0, Math.min(1, Number(fabricObj?.opacity ?? 1))),
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, fallbackPrefix)),
    P: page.ref,
  };
}

export function adaptHighlight(fabricObj, { pdfDoc, page, pageHeight }) {
  const dict = buildTextMarkupDict({
    subtype: 'Highlight',
    fabricObj,
    pageHeight,
    page,
    colorFallback: '#FFFF00',
    fallbackPrefix: 'highlight',
    useFill: true,
  });
  if (!dict) return null;
  return registerAnnotationDict(pdfDoc, dict);
}

export function adaptUnderline(fabricObj, { pdfDoc, page, pageHeight }) {
  const dict = buildTextMarkupDict({
    subtype: 'Underline',
    fabricObj,
    pageHeight,
    page,
    colorFallback: '#FF0000',
    fallbackPrefix: 'underline',
    useFill: true,
  });
  if (!dict) return null;
  return registerAnnotationDict(pdfDoc, dict);
}

export function adaptSquiggly(fabricObj, { pdfDoc, page, pageHeight }) {
  const dict = buildTextMarkupDict({
    subtype: 'Squiggly',
    fabricObj,
    pageHeight,
    page,
    colorFallback: '#FF0000',
    fallbackPrefix: 'squiggly',
    useFill: true,
  });
  if (!dict) return null;
  return registerAnnotationDict(pdfDoc, dict);
}

export function adaptStrikeOut(fabricObj, { pdfDoc, page, pageHeight }) {
  const dict = buildTextMarkupDict({
    subtype: 'StrikeOut',
    fabricObj,
    pageHeight,
    page,
    colorFallback: '#FF0000',
    fallbackPrefix: 'strikeout',
    useFill: true,
  });
  if (!dict) return null;
  return registerAnnotationDict(pdfDoc, dict);
}
