// Ink adapter: Fabric.js Path → PDF /Subtype /Ink annotation.
// Phase D of pdfNativeExport. Fabric path commands are converted to a
// PDF InkList — an array of arrays of [x,y,x,y,...]. Each /M starts a
// new sub-path. Round-tripped by
// pdfAnnotationImporter.convertInkToFabricPath.

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

export const FABRIC_TYPE = 'path';
export const PDF_SUBTYPE = 'Ink';

export function adaptInk(fabricObj, { pdfDoc, page, pageHeight }) {
  const pathData = Array.isArray(fabricObj?.path) ? fabricObj.path : null;
  if (!pathData || pathData.length === 0) return null;

  const inkList = [];
  let currentPath = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const pushPoint = (x, y) => {
    const py = flipY(pageHeight, y);
    currentPath.push(x, py);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  };

  for (const cmd of pathData) {
    const command = cmd?.[0];
    if (command === 'M') {
      if (currentPath.length > 0) inkList.push(currentPath);
      currentPath = [];
      pushPoint(Number(cmd[1]) || 0, Number(cmd[2]) || 0);
    } else if (command === 'L') {
      pushPoint(Number(cmd[1]) || 0, Number(cmd[2]) || 0);
    } else if (command === 'Q') {
      pushPoint(Number(cmd[3]) || 0, Number(cmd[4]) || 0);
    } else if (command === 'C') {
      pushPoint(Number(cmd[5]) || 0, Number(cmd[6]) || 0);
    }
  }

  if (currentPath.length > 0) inkList.push(currentPath);
  if (inkList.length === 0) return null;

  const stroke = hexToRgbTriplet(getFabricStroke(fabricObj));

  const dict = {
    Type: 'Annot',
    Subtype: PDF_SUBTYPE,
    Rect: [minX, minY, maxX, maxY],
    InkList: inkList,
    C: stroke,
    Border: makeBorderArray(getStrokeWidth(fabricObj)),
    Contents: pdfStringOrEmpty(''),
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'ink')),
    P: page.ref,
  };

  return registerAnnotationDict(pdfDoc, dict);
}
