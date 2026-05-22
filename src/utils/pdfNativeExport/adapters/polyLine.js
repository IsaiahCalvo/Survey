// PolyLine adapter: Fabric.js Polyline → PDF /Subtype /PolyLine annotation.
// Phase D of pdfNativeExport. Same vertex layout as Polygon but the path
// is not closed. Round-tripped by
// pdfAnnotationImporter.convertPolyLineToFabricPolyline.

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

export const FABRIC_TYPE = 'polyline';
export const PDF_SUBTYPE = 'PolyLine';

export function adaptPolyLine(fabricObj, { pdfDoc, page, pageHeight }) {
  const points = Array.isArray(fabricObj?.points) ? fabricObj.points : [];
  if (points.length < 2) return null;

  const left = Number(fabricObj?.left) || 0;
  const top = Number(fabricObj?.top) || 0;

  const vertices = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    const px = left + Number(point.x);
    const py = flipY(pageHeight, top + Number(point.y));
    vertices.push(px, py);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  const stroke = hexToRgbTriplet(getFabricStroke(fabricObj));

  const dict = {
    Type: 'Annot',
    Subtype: PDF_SUBTYPE,
    Rect: [minX, minY, maxX, maxY],
    Vertices: vertices,
    C: stroke,
    Border: makeBorderArray(getStrokeWidth(fabricObj)),
    Contents: pdfStringOrEmpty(''),
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'polyline')),
    P: page.ref,
  };

  return registerAnnotationDict(pdfDoc, dict);
}
