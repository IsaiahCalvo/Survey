// Square adapter: Fabric.js Rect → PDF /Subtype /Square annotation.
// Phase D of pdfNativeExport. Produces an editable native PDF rectangle
// (NOT a flattened content stream) so the round-trip can re-import via
// pdfAnnotationImporter.convertSquareToFabricRect.

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

export const FABRIC_TYPE = 'rect';
export const PDF_SUBTYPE = 'Square';

export function adaptSquare(fabricObj, { pdfDoc, page, pageHeight }) {
  const rect = appBoundsToPdfRect({
    left: Number(fabricObj?.left) || 0,
    top: Number(fabricObj?.top) || 0,
    width: Number(fabricObj?.width) || 0,
    height: Number(fabricObj?.height) || 0,
  }, pageHeight);

  if (rect.width <= 0 || rect.height <= 0) return null;

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
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'square')),
    P: page.ref,
  };

  if (fillTriplet) dict.IC = fillTriplet;

  return registerAnnotationDict(pdfDoc, dict);
}
