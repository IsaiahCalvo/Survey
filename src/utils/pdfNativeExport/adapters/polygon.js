// Polygon adapter: Fabric.js Polygon → PDF /Subtype /Polygon annotation.
// Phase D of pdfNativeExport. Vertices are flattened to a [x1,y1,x2,y2...]
// number array per PDF spec, with Y-flip. Round-tripped by
// pdfAnnotationImporter.convertPolygonToFabricPolygon.

import {
  flipY,
  hexToRgbTriplet,
  makeBorderArray,
  pdfStringOrEmpty,
  registerAnnotationDict,
  resolveAnnotationName,
  getStrokeWidth,
  getFabricFill,
  getFabricStroke,
} from './shared.js';

export const PDF_SUBTYPE = 'Polygon';

export function adaptPolygon(fabricObj, { pdfDoc, page, pageHeight }) {
  const points = Array.isArray(fabricObj?.points) ? fabricObj.points : [];
  if (points.length < 3) return null;

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
  const fill = getFabricFill(fabricObj);
  const fillTriplet = fill ? hexToRgbTriplet(fill) : null;

  const dict = {
    Type: 'Annot',
    Subtype: PDF_SUBTYPE,
    Rect: [minX, minY, maxX, maxY],
    Vertices: vertices,
    C: stroke,
    Border: makeBorderArray(getStrokeWidth(fabricObj)),
    Contents: pdfStringOrEmpty(''),
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'polygon')),
    P: page.ref,
  };

  if (fillTriplet) dict.IC = fillTriplet;

  return registerAnnotationDict(pdfDoc, dict);
}
