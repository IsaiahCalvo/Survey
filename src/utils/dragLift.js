// Dense-sheet drags (perf): while marks are moved, SVGAnnotationLayer paints
// them untransformed in their own composited <svg> above the page layer and
// shifts that svg with a CSS translate. A drag frame is then a compositor
// move instead of a repaint and re-raster of every tile of a page holding
// hundreds of marks (6 marks dragged on a 667-mark sheet re-rastered ~7 tiles
// per frame, 2.6 s of raster per second of dragging in software raster).

/**
 * The annotation indices a live preview lifts, or null. Only a pointer move's
 * plain translate lifts (move, group move). Keyboard nudges (one frame per
 * key), resize, rotate, line edits, rebuilt previews and a mark carried onto
 * another page stay in the page layer.
 */
export function liftedMoveIndices(visualTransform) {
  const vt = visualTransform;
  if (!vt || vt.nudge || vt.crossPageAway || vt.resize || vt.rotate || vt.lineEdit || vt.previewObjects
    || vt.counterPointerAngle != null) return null;
  if (typeof vt.id === 'number') return new Set([vt.id]);
  if (vt.id === 'group' && vt.affectedIds?.size) return vt.affectedIds;
  return null;
}

/**
 * The lift layer's CSS translate, in percent of its own box (the page), so
 * page units map to screen with no measuring: the viewBox still owns zoom.
 */
export function liftTranslate(visualTransform, pageWidth, pageHeight) {
  const pct = (delta, size) => (size > 0 && Number.isFinite(delta) ? (delta / size) * 100 : 0);
  return `translate(${pct(visualTransform?.dx || 0, pageWidth)}%, ${pct(visualTransform?.dy || 0, pageHeight)}%)`;
}
