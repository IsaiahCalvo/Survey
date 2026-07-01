// Pure geometry helpers lifted out of PDFViewer.jsx (de-fragilize campaign).
// Standalone + zero-dep so node tests can import without the browser graph.

// Check whether two bounds rectangles match within a floating-point tolerance.
// Accepts either {x,y,width,height} or {left,top,right,bottom} shapes (or a mix):
// x falls back to left, y to top, width to right-left, height to bottom-top.
export const boundsMatch = (bounds1, bounds2, tolerance = 5) => {
  if (!bounds1 || !bounds2) return false;
  return (
    Math.abs((bounds1.x || bounds1.left) - (bounds2.x || bounds2.left)) < tolerance &&
    Math.abs((bounds1.y || bounds1.top) - (bounds2.y || bounds2.top)) < tolerance &&
    Math.abs((bounds1.width || bounds1.right - bounds1.left) - (bounds2.width || bounds2.right - bounds2.left)) < tolerance &&
    Math.abs((bounds1.height || bounds1.bottom - bounds1.top) - (bounds2.height || bounds2.bottom - bounds2.top)) < tolerance
  );
};
