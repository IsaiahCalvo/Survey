// Circle adapter: Fabric.js Circle → PDF /Subtype /Circle annotation.
// Phase D of pdfNativeExport. The PDF spec defines /Circle as a bounding
// rect containing an ellipse — we honor radius * 2 for both width and
// height to match the importer's convertCircleToFabricCircle.

import {
  appBoundsToPdfRect,
  hexToRgbTriplet,
  makeBorderArray,
  pdfStringOrEmpty,
  registerAnnotationDict,
  resolveAnnotationName,
  getStrokeWidth,
  getFabricFill,
  getFabricStroke,
} from './shared.js';

export const FABRIC_TYPE = 'circle';
export const PDF_SUBTYPE = 'Circle';

export function adaptCircle(fabricObj, { pdfDoc, page, pageHeight }) {
  const left = Number(fabricObj?.left) || 0;
  const top = Number(fabricObj?.top) || 0;
  const radius = Number(fabricObj?.radius) || 0;
  const width = radius * 2;
  const height = radius * 2;

  if (radius <= 0) return null;

  const rect = appBoundsToPdfRect({ left, top, width, height }, pageHeight);
  const stroke = hexToRgbTriplet(getFabricStroke(fabricObj));
  const fill = getFabricFill(fabricObj);
  const fillTriplet = fill ? hexToRgbTriplet(fill) : null;

  const dict = {
    Type: 'Annot',
    Subtype: PDF_SUBTYPE,
    Rect: [rect.x1, rect.y1, rect.x2, rect.y2],
    C: stroke,
    Border: makeBorderArray(getStrokeWidth(fabricObj)),
    Contents: pdfStringOrEmpty(''),
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'circle')),
    P: page.ref,
  };

  if (fillTriplet) dict.IC = fillTriplet;

  return registerAnnotationDict(pdfDoc, dict);
}
