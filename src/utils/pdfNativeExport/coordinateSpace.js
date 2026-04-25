// Coordinate-space helpers for the PDF-native export bake pipeline.
// Our app stores annotations in PDF user-space points (1/72 inch) but
// keeps Y origin at top-left to match Fabric.js conventions. The PDF
// spec puts Y origin at bottom-left, so the bake step Y-flips and
// converts an app rect (left/top/width/height) into PDF rect corners
// (x1,y1 lower-left, x2,y2 upper-right).

export function appRectToPdfPoints(rect, pageHeightPt) {
  const x1 = rect.left;
  const x2 = rect.left + rect.width;
  const y2 = pageHeightPt - rect.top;
  const y1 = y2 - rect.height;
  return { x: x1, x1, x2, y1, y2, width: rect.width, height: rect.height };
}

export function pdfPointsToAppRect(pts, pageHeightPt) {
  return {
    left: pts.x1,
    top: pageHeightPt - pts.y2,
    width: pts.x2 - pts.x1,
    height: pts.y2 - pts.y1,
  };
}
