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
  getFabricFill,
  getFabricStroke,
} from './shared.js';

export const FABRIC_TYPE = 'path';
export const PDF_SUBTYPE = 'Ink';

// Paper-ink awareness (item 6, INK-MODEL-AND-IMPORT-NORMALIZATION-2026-07-17):
// filled paper ink persists the true pen CENTERLINE + source width alongside
// its filled-outline geometry. The InkList must carry that centerline with
// the source width in /Border — dumping the outline-ring endpoints with
// width 0 makes the stroke un-editable (and invisible) in external editors.
// Mirrors the live exporter's centerline fallback in pdfAnnotationsPdfLib's
// createFilledPaperInkAnnotation: partially ERASED paper ink is excluded
// (its centerline no longer matches the visible shape), falling back to the
// outline path with width 0, exactly like the live path.
function adaptPaperInkCenterline(fabricObj, { pdfDoc, page, pageHeight }) {
  const centerline = fabricObj.paperCenterline;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const points = [];
  for (const point of centerline) {
    const x = Number(point?.x) || 0;
    const py = flipY(pageHeight, Number(point?.y) || 0);
    points.push(x, py);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (points.length === 0) return null;

  const dict = {
    Type: 'Annot',
    Subtype: PDF_SUBTYPE,
    Rect: [minX, minY, maxX, maxY],
    InkList: [points],
    // Paper ink is a FILLED shape — its color lives in fill, not stroke.
    C: hexToRgbTriplet(getFabricFill(fabricObj) || getFabricStroke(fabricObj)),
    Border: makeBorderArray(Number(fabricObj.sourceWidth) || 1),
    Contents: pdfStringOrEmpty(''),
    NM: pdfStringOrEmpty(resolveAnnotationName(fabricObj, 'ink')),
    P: page.ref,
  };

  return registerAnnotationDict(pdfDoc, dict);
}

export function adaptInk(fabricObj, { pdfDoc, page, pageHeight }) {
  const usePaperCenterline = !fabricObj?.paperEraserGeometry
    && Array.isArray(fabricObj?.paperCenterline)
    && fabricObj.paperCenterline.length > 0;
  if (usePaperCenterline) {
    return adaptPaperInkCenterline(fabricObj, { pdfDoc, page, pageHeight });
  }

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
