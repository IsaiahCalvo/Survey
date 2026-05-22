// Line adapter: Fabric.js Line → PDF /Subtype /Line annotation.
// Phase D of pdfNativeExport. Preserves arrow endings (LE) when present
// on the Fabric object — pdfAnnotationImporter restores these via
// convertLineToFabricLine.

import { PDFName } from 'pdf-lib';
import {
  flipY,
  hexToRgbTriplet,
  makeBorderArray,
  pdfStringOrEmpty,
  registerAnnotationDict,
  resolveAnnotationName,
  getStrokeWidth,
  getFabricStroke,
} from './shared.js';

export const FABRIC_TYPE = 'line';
export const PDF_SUBTYPE = 'Line';

export function adaptLine(fabricObj, { pdfDoc, page, pageHeight }) {
  const x1 = Number(fabricObj?.x1) || 0;
  const y1 = Number(fabricObj?.y1) || 0;
  const x2 = Number(fabricObj?.x2) || 0;
  const y2 = Number(fabricObj?.y2) || 0;

  if (x1 === x2 && y1 === y2) return null;

  const py1 = flipY(pageHeight, y1);
  const py2 = flipY(pageHeight, y2);
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(py1, py2);
  const maxY = Math.max(py1, py2);

  const stroke = hexToRgbTriplet(getFabricStroke(fabricObj));

  const dict = {
    Type: 'Annot',
    Subtype: PDF_SUBTYPE,
    Rect: [minX, minY, maxX, maxY],
    L: [x1, py1, x2, py2],
    C: stroke,
    Border: makeBorderArray(getStrokeWidth(fabricObj)),
    Contents: pdfStringOrEmpty(''),
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'line')),
    P: page.ref,
  };

  if (fabricObj?.lineEnding1 || fabricObj?.lineEnding2) {
    dict.LE = [
      PDFName.of(fabricObj.lineEnding1 || 'None'),
      PDFName.of(fabricObj.lineEnding2 || 'None'),
    ];
  }

  return registerAnnotationDict(pdfDoc, dict);
}
