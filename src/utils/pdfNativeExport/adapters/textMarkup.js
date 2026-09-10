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

import { PDFName } from 'pdf-lib';
import {
  hexToRgbTriplet,
  pdfStringOrEmpty,
  registerAnnotationDict,
  resolveAnnotationName,
  getFabricFill,
  getFabricStroke,
} from './shared.js';
import { attachMarkedForRedactionAppearance } from '../../pdfRedactionSafety.js';


const normalizedRightAngle = (value) => {
  const angle = ((Number(value) || 0) % 360 + 360) % 360;
  return [0, 90, 180, 270].includes(angle) ? angle : 0;
};

// PDF 32000-1 §7.9.5: a rectangle's corners may be given in EITHER order, so
// [x1 y1 x0 y0] is a legal /CropBox. pdf-lib's asRectangle() subtracts blindly
// and hands back a negative width/height; pdf.js normalises (lookupNormalRect)
// and the app renders such a page perfectly. An un-normalised box gave the
// exporter negative-height page bounds, which made every /Rect fail
// exportAnnotationRefHasValidGeometry - a silent, total annotation loss (the
// export came out with 0 /Annots and the flattened print blank).
const normalizeBoxRect = (box) => {
  if (!box) return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width);
  const height = Number(box.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x: Math.min(x, x + width),
    y: Math.min(y, y + height),
    width: Math.abs(width),
    height: Math.abs(height),
  };
};

const usableBoxRect = (box) => Boolean(box) && box.width > 0 && box.height > 0;

const intersectBoxRects = (first, second) => {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return { x, y, width: right - x, height: bottom - y };
};

/**
 * The page frame every annotation writer and the print flattener author in.
 *
 * It must be the frame the APP shows, which is pdf.js' default viewport, and
 * pdf.js (PDF 32000-1 §14.11.2, Page#view) uses CropBox INTERSECT MediaBox
 * with both boxes normalised - NOT the raw /CropBox. A CropBox that is larger
 * than the MediaBox, or hangs off it, therefore put every exported annotation
 * 60-78pt away from where the app draws it in both the annotated and the
 * flattened output. Same fallback order as pdf.js: an empty intersection or an
 * unusable box falls back to the MediaBox rather than dropping annotations.
 */
export function getTextMarkupPageGeometry(page, fallbackPageHeight = 0) {
  const size = page?.getSize?.() || { width: 0, height: Number(fallbackPageHeight) || 0 };
  const sizeBox = normalizeBoxRect({ x: 0, y: 0, width: size.width, height: size.height });
  let media = null;
  try {
    media = normalizeBoxRect(page?.getMediaBox?.());
  } catch {
    media = null;
  }
  if (!usableBoxRect(media)) {
    if (media) console.warn('[pdf-export] unusable /MediaBox; falling back to the page size');
    media = usableBoxRect(sizeBox)
      ? sizeBox
      : { x: 0, y: 0, width: Number(size.width) || 0, height: Number(fallbackPageHeight) || 0 };
  }
  let crop = null;
  try {
    crop = normalizeBoxRect(page?.getCropBox?.());
  } catch {
    crop = null;
  }
  let box = media;
  if (usableBoxRect(crop)) {
    const intersection = intersectBoxRects(crop, media);
    if (usableBoxRect(intersection)) {
      box = intersection;
    } else {
      console.warn('[pdf-export] empty /CropBox ∩ /MediaBox intersection; using the /MediaBox');
    }
  } else if (crop) {
    console.warn('[pdf-export] unusable /CropBox; using the /MediaBox');
  }
  return {
    x: box.x,
    y: box.y,
    width: box.width || Number(size.width) || 0,
    height: box.height || Number(size.height) || Number(fallbackPageHeight) || 0,
    rotation: normalizedRightAngle(page?.getRotation?.()?.angle),
  };
}

export function viewportPointToPdfPoint(point, geometry) {
  const u = Number(point?.x) || 0;
  const v = Number(point?.y) || 0;
  const { x, y, width, height, rotation } = geometry;
  if (rotation === 90) return { x: x + v, y: y + u };
  if (rotation === 180) return { x: x + width - u, y: y + v };
  if (rotation === 270) return { x: x + width - v, y: y + height - u };
  return { x: x + u, y: y + height - v };
}

export function viewportPointToBaseAppPoint(point, geometry) {
  const pdfPoint = viewportPointToPdfPoint(point, geometry);
  return {
    x: pdfPoint.x - geometry.x,
    y: geometry.height - (pdfPoint.y - geometry.y),
  };
}

const quadToPoints = (quad) => [
  { x: quad.x1, y: quad.y1 },
  { x: quad.x2, y: quad.y2 },
  { x: quad.x3, y: quad.y3 },
  { x: quad.x4, y: quad.y4 },
];

function buildQuadPointsFromBounds({ left, top, width, height }, geometry) {
  return quadToPoints({
    x1: left, y1: top,
    x2: left + width, y2: top,
    x3: left, y3: top + height,
    x4: left + width, y4: top + height,
  }).flatMap((point) => {
    const pdfPoint = viewportPointToPdfPoint(point, geometry);
    return [pdfPoint.x, pdfPoint.y];
  });
}

function buildTextMarkupDict({
  subtype,
  fabricObj,
  pageHeight,
  page,
  colorFallback,
  fallbackPrefix,
  useFill = false,
  includeContents = true,
}) {
  const geometry = getTextMarkupPageGeometry(page, pageHeight);
  const bounds = {
    left: Number(fabricObj?.left) || 0,
    top: Number(fabricObj?.top) || 0,
    width: Number(fabricObj?.width) || 0,
    height: Number(fabricObj?.height) || 0,
  };
  if (bounds.width <= 0 || bounds.height <= 0) return null;

  const storedQuads = Array.isArray(fabricObj?.data?.quads) ? fabricObj.data.quads : [];
  const quadPoints = storedQuads.length > 0
    ? storedQuads.flatMap((quad) => quadToPoints(quad).flatMap((point) => {
        const pdfPoint = viewportPointToPdfPoint(point, geometry);
        return [pdfPoint.x, pdfPoint.y];
      }))
    : buildQuadPointsFromBounds(bounds, geometry);
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
    // UX: round-trip authored stroke weight instead of returning a default hairline.
    ...(['Underline', 'StrikeOut', 'Squiggly'].includes(subtype) && Number.isFinite(fabricObj?.data?.lineWidth)
      ? { BS: { W: Math.max(0, fabricObj.data.lineWidth), S: PDFName.of('S') } } : {}),
    Rect: [minX, minY, maxX, maxY],
    QuadPoints: quadPoints,
    C: color,
    ...(includeContents ? { Contents: pdfStringOrEmpty(fabricObj?.data?.selectedText || '') } : {}),
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

export function adaptLink(fabricObj, { pdfDoc, page, pageHeight }) {
  const dict = buildTextMarkupDict({
    subtype: 'Link',
    fabricObj,
    pageHeight,
    page,
    colorFallback: '#2563EB',
    fallbackPrefix: 'link',
    useFill: false,
  });
  const linkUrl = String(fabricObj?.data?.linkUrl || '').trim();
  const linkPageNumber = Math.trunc(Number(fabricObj?.data?.linkPageNumber));
  if (!dict || (!linkUrl && !(linkPageNumber > 0))) return null;
  delete dict.QuadPoints;
  delete dict.C;
  delete dict.CA;
  dict.Border = [0, 0, 0];
  if (linkPageNumber > 0) {
    const targetPage = pdfDoc.getPages()[linkPageNumber - 1];
    if (!targetPage) return null;
    dict.A = { S: PDFName.of('GoTo'), D: [targetPage.ref, PDFName.of('Fit')] };
  } else {
    dict.A = { S: PDFName.of('URI'), URI: pdfStringOrEmpty(linkUrl) };
  }
  return registerAnnotationDict(pdfDoc, dict);
}

export function adaptRedact(fabricObj, { pdfDoc, page, pageHeight }) {
  const dict = buildTextMarkupDict({
    subtype: 'Redact',
    fabricObj,
    pageHeight,
    page,
    colorFallback: '#000000',
    fallbackPrefix: 'redact',
    useFill: true,
    includeContents: false,
  });
  if (!dict) return null;
  dict.IC = [0, 0, 0];
  dict.C = [0, 0, 0];
  dict.CA = 1;
  attachMarkedForRedactionAppearance(pdfDoc, dict);
  return registerAnnotationDict(pdfDoc, dict);
}
