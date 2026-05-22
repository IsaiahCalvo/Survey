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
