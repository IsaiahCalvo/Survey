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

export const FABRIC_TYPE = 'rect';

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

  const quadPoints = buildQuadPointsFromBounds(bounds, pageHeight);
  const minX = quadPoints[4];
  const minY = quadPoints[5];
  const maxX = quadPoints[2];
  const maxY = quadPoints[1];

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
    Contents: pdfStringOrEmpty(''),
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
