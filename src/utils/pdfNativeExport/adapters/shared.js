// Shared helpers for the Phase D pdfNativeExport adapter pipeline.
// Adapters MUST NOT duplicate logic from src/utils/pdfAnnotationsPdfLib.js
// (the contract there is locked by KAL-52). These helpers are local-only
// and handle color parsing, Y-flip, and dict registration so each adapter
// stays small and round-trip-safe with pdfAnnotationImporter.

import { PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { appRectToPdfPoints } from '../coordinateSpace.js';

const HEX_RE = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;
const RGBA_RE = /rgba?\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)/i;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

export function hexToRgbTriplet(input, fallback = '#000000') {
  const raw = typeof input === 'string' && input.length > 0 ? input : fallback;
  const rgba = raw.match(RGBA_RE);
  if (rgba) {
    return [
      clamp01(Number(rgba[1]) / 255),
      clamp01(Number(rgba[2]) / 255),
      clamp01(Number(rgba[3]) / 255),
    ];
  }
  const m = HEX_RE.exec(raw);
  if (m) {
    return [
      parseInt(m[1], 16) / 255,
      parseInt(m[2], 16) / 255,
      parseInt(m[3], 16) / 255,
    ];
  }
  return [0, 0, 0];
}

export function flipY(pageHeight, appY) {
  return pageHeight - appY;
}

export function appPointToPdf(pageHeight, x, y) {
  return { x, y: flipY(pageHeight, y) };
}

export function appBoundsToPdfRect({ left = 0, top = 0, width = 0, height = 0 }, pageHeight) {
  return appRectToPdfPoints({ left, top, width, height }, pageHeight);
}

export function makeBorderArray(strokeWidth) {
  const width = Number.isFinite(strokeWidth) && strokeWidth >= 0 ? strokeWidth : 1;
  return [0, 0, width];
}

export function registerAnnotationDict(pdfDoc, dict) {
  return pdfDoc.context.register(pdfDoc.context.obj(dict));
}

export function attachAnnotationToPage(pdfDoc, page, ref) {
  if (!ref) return false;
  let annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) {
    annots = pdfDoc.context.obj([]);
    page.node.set(PDFName.of('Annots'), annots);
  }
  annots.push(ref);
  return true;
}

export function resolveAnnotationName(fabricObj, fallbackPrefix) {
  const id = (
    fabricObj?.pdfAnnotationId
    || fabricObj?.id
    || fabricObj?.data?.id
    || `${fallbackPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  );
  return String(id);
}

export function pdfStringOrEmpty(value) {
  return PDFString.of(String(value ?? ''));
}

export function pdfNumberArray(values) {
  return values.map((v) => PDFNumber.of(Number(v) || 0));
}

export function getStrokeWidth(fabricObj, fallback = 1) {
  const value = Number(fabricObj?.strokeWidth);
  if (Number.isFinite(value) && value >= 0) return value;
  return fallback;
}

export function getFabricFill(fabricObj) {
  const fill = fabricObj?.fill;
  if (!fill || fill === 'transparent' || fill === 'rgba(0,0,0,0)') return null;
  return fill;
}

export function getFabricStroke(fabricObj, fallback = '#000000') {
  const stroke = fabricObj?.stroke;
  if (!stroke || stroke === 'transparent') return fallback;
  return stroke;
}

// UX 2026-07-09 (erased-outline PDF export): a previously-erased pen stroke
// (or a PDF-imported Drawboard/Adobe pressure-ink dot) is stored in Fabric
// as a FILLED zero-width outline — {strokeWidth: 0, fill: <color>}, possibly
// with hole rings as separate M...Z subpaths (see
// src/utils/geometryEraser.js booleanErasePath / groupRingsIntoPolygons).
// Mirrors isErasedOutline in src/utils/svgAnnotationRenderers.jsx so export
// detection agrees with what the renderer already treats as "filled."
export function isFilledOutlinePath(fabricObj) {
  const strokeWidth = Number(fabricObj?.strokeWidth);
  const strokeIsZeroish = !Number.isFinite(strokeWidth) || strokeWidth <= 0;
  const fill = fabricObj?.fill;
  const hasVisibleFill = fill !== null && fill !== undefined && fill !== '' && fill !== 'none' && fill !== 'transparent';
  return strokeIsZeroish && hasVisibleFill;
}

const formatPdfNum = (n) => {
  if (!Number.isFinite(n)) return '0';
  // Fixed precision keeps the content stream compact and avoids float noise.
  return String(Math.round(n * 1000) / 1000);
};

/**
 * Converts Fabric path commands (M/L/Q/C/Z) into PDF content-stream path
 * operators for a FILL-only appearance (no stroke). Quadratic (Q) segments
 * are degree-elevated to exact cubic Beziers — PDF content streams only
 * support cubic curves ('c') — via the standard elevation formula:
 *   C1 = P0 + 2/3*(P1-P0),  C2 = P2 + 2/3*(P1-P2)
 * which reproduces the same curve as the source quadratic exactly.
 */
export function buildFillAppearanceOps(pathData, pageHeight) {
  if (!Array.isArray(pathData) || pathData.length === 0) return null;

  const ops = [];
  let cur = null;
  let hasDrawableSegment = false;
  const flip = (y) => flipY(pageHeight, y);

  pathData.forEach((cmd) => {
    if (!Array.isArray(cmd) || cmd.length === 0) return;
    const type = cmd[0];

    if (type === 'M') {
      const x = Number(cmd[1]) || 0;
      const y = Number(cmd[2]) || 0;
      ops.push(`${formatPdfNum(x)} ${formatPdfNum(flip(y))} m`);
      cur = { x, y };
    } else if (type === 'L') {
      const x = Number(cmd[1]) || 0;
      const y = Number(cmd[2]) || 0;
      ops.push(`${formatPdfNum(x)} ${formatPdfNum(flip(y))} l`);
      cur = { x, y };
      hasDrawableSegment = true;
    } else if (type === 'Q') {
      const qx = Number(cmd[1]) || 0;
      const qy = Number(cmd[2]) || 0;
      const ex = Number(cmd[3]) || 0;
      const ey = Number(cmd[4]) || 0;
      const startX = cur ? cur.x : qx;
      const startY = cur ? cur.y : qy;
      const c1x = startX + (2 / 3) * (qx - startX);
      const c1y = startY + (2 / 3) * (qy - startY);
      const c2x = ex + (2 / 3) * (qx - ex);
      const c2y = ey + (2 / 3) * (qy - ey);
      ops.push(
        `${formatPdfNum(c1x)} ${formatPdfNum(flip(c1y))} ${formatPdfNum(c2x)} ${formatPdfNum(flip(c2y))} ${formatPdfNum(ex)} ${formatPdfNum(flip(ey))} c`
      );
      cur = { x: ex, y: ey };
      hasDrawableSegment = true;
    } else if (type === 'C') {
      const c1x = Number(cmd[1]) || 0;
      const c1y = Number(cmd[2]) || 0;
      const c2x = Number(cmd[3]) || 0;
      const c2y = Number(cmd[4]) || 0;
      const ex = Number(cmd[5]) || 0;
      const ey = Number(cmd[6]) || 0;
      ops.push(
        `${formatPdfNum(c1x)} ${formatPdfNum(flip(c1y))} ${formatPdfNum(c2x)} ${formatPdfNum(flip(c2y))} ${formatPdfNum(ex)} ${formatPdfNum(flip(ey))} c`
      );
      cur = { x: ex, y: ey };
      hasDrawableSegment = true;
    } else if (type === 'Z') {
      ops.push('h');
    }
  });

  if (!hasDrawableSegment) return null;
  return ops.join('\n');
}

/**
 * Builds and registers a Form XObject /AP /N appearance stream that fills
 * the path with an even-odd winding rule — matches the SVG renderer's
 * fillRule for erased/filled-outline ink (src/utils/svgAnnotationRenderers.jsx,
 * isErasedOutline branch: `fillRule={erased ? 'evenodd' : attrs.fillRule}`) so
 * hole rings render as holes instead of solid fill.
 *
 * Rect and the Form's BBox are set to the SAME bounds with an identity
 * Matrix so, per PDF spec 12.5.5, the appearance's BBox-to-Rect fit
 * transform collapses to identity: content-stream coordinates equal page
 * coordinates directly. This matches how
 * pdfAnnotationImporter.convertAppearancePathToFabricPath treats /AP path
 * coordinates as already being in page space.
 */
export function buildFillAppearanceStream(pdfDoc, pathData, pageHeight, fillRGB, rect) {
  const ops = buildFillAppearanceOps(pathData, pageHeight);
  if (!ops) return null;

  const [r, g, b] = fillRGB;
  const content = `${formatPdfNum(r)} ${formatPdfNum(g)} ${formatPdfNum(b)} rg\n${ops}\nf*`;

  const apStream = pdfDoc.context.stream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: rect,
    Matrix: [1, 0, 0, 1, 0, 0],
    Resources: {},
  });

  return pdfDoc.context.register(apStream);
}
