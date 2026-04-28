/**
 * Pure attribute derivation for path-type Fabric objects rendered as SVG
 * <path> elements. Extracted from src/utils/svgAnnotationRenderers.jsx so
 * node-test (.mjs) suites can import it without pulling JSX through the
 * Node loader. Same pattern as src/components/propertiesPanelShape.js.
 *
 * UX 2026-04-28: PDF-imported Ink has two different real-world shapes:
 * normal open pen lines, and closed zero-width outlines emitted by Adobe /
 * Drawboard for filled marker dots and pressure ink. Open lines get
 * vector-effect:non-scaling-stroke plus a minimum visible width so they
 * do not disappear at low zoom. Closed thin outlines render as filled
 * shapes instead of stroked paths, otherwise they look like hollow rings.
 *
 * Prior 2026-04-21 normalization removed strokeUniform from imports
 * for parity with internal pen strokes; that solved a 200% hairline
 * mismatch but introduced the sub-pixel invisibility regression.
 * Provenance-conditional rendering for IMPORTED paths only is the
 * surgical balance — see also tests/pdfAnnotationNormalization.test.mjs.
 */

// Minimum SVG user-unit stroke width for open PDF-imported paths. Combined
// with vector-effect:non-scaling-stroke this becomes the device-pixel floor
// regardless of zoom.
const IMPORTED_PATH_MIN_STROKE_WIDTH = 2.5;
const FILLED_PDF_INK_MODE = 'filled-outline';

/**
 * Detect a PDF-imported path. Preferred signal is `isPdfImported: true`
 * set by the importer (src/utils/pdfAnnotationImporter.js). For
 * defense-in-depth we also accept any non-empty `pdfAnnotationType`,
 * since some legacy serialization paths can drop the boolean flag while
 * preserving the type string. Either signal means "this came in from a
 * source PDF, treat for visibility."
 */
function isPdfImportedPath(obj) {
  if (obj?.isPdfImported === true) return true;
  if (typeof obj?.pdfAnnotationType === 'string' && obj.pdfAnnotationType.length > 0) return true;
  return false;
}

function isVisiblePaint(value) {
  return value != null && value !== '' && value !== 'none' && value !== 'transparent';
}

function getPathEndpoint(seg) {
  if (!Array.isArray(seg) || seg.length === 0) return null;
  const cmd = seg[0];
  if (cmd === 'M' || cmd === 'L') return { x: seg[1], y: seg[2] };
  if (cmd === 'Q') return { x: seg[3], y: seg[4] };
  if (cmd === 'C') return { x: seg[5], y: seg[6] };
  return null;
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getPathBounds(path) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of path || []) {
    for (let j = 1; j + 1 < seg.length; j += 2) {
      const x = seg[j];
      const y = seg[j + 1];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { width: maxX - minX, height: maxY - minY };
}

function allSubpathsAreClosed(path) {
  if (!Array.isArray(path) || path.length === 0) return false;

  const bounds = getPathBounds(path);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
  const closeThreshold = Math.max(0.75, Math.min(bounds.width, bounds.height) * 0.25);

  let start = null;
  let current = null;
  let hasDrawableSubpath = false;
  let currentClosed = false;
  const closeCurrent = () => {
    if (!start || !current || !hasDrawableSubpath) return true;
    return currentClosed || distance(start, current) <= closeThreshold;
  };

  for (const seg of path) {
    if (!Array.isArray(seg) || seg.length === 0) continue;

    if (seg[0] === 'M') {
      if (start && !closeCurrent()) return false;
      start = getPathEndpoint(seg);
      current = start;
      hasDrawableSubpath = false;
      currentClosed = false;
      continue;
    }

    if (seg[0] === 'Z') {
      currentClosed = true;
      current = start;
      continue;
    }

    const endpoint = getPathEndpoint(seg);
    if (endpoint) {
      current = endpoint;
      hasDrawableSubpath = true;
    }
  }

  return Boolean(start && hasDrawableSubpath && closeCurrent());
}

function shouldFillPdfInkOutline(obj) {
  if (!isPdfImportedPath(obj) || obj?.pdfAnnotationType !== 'Ink') return false;
  if (obj?.pdfInkRenderMode === FILLED_PDF_INK_MODE || obj?.data?.pdfInkRenderMode === FILLED_PDF_INK_MODE) {
    return true;
  }
  if (isVisiblePaint(obj?.fill)) return false;

  // Drawboard/Adobe often save marker dots and pressure ink as closed
  // zero-width outlines. Existing cloud rows may only have our 0.9 fallback
  // width, so detect the geometry too instead of relying only on new imports.
  const rawWidth = Number(obj?.strokeWidth ?? 1);
  return rawWidth <= 1.1 && allSubpathsAreClosed(obj?.path);
}

function formatPathCommand(seg) {
  return Array.isArray(seg) ? seg.join(' ') : '';
}

function collectSubpaths(path) {
  const subpaths = [];
  let current = null;

  for (const seg of path || []) {
    if (!Array.isArray(seg) || seg.length === 0) continue;

    if (seg[0] === 'M') {
      if (current?.points?.length > 0) subpaths.push(current);
      const point = getPathEndpoint(seg);
      current = { points: point ? [point] : [], hasCubic: false };
      continue;
    }

    if (!current) continue;

    if (seg[0] === 'Q') {
      current.points.push({ x: seg[1], y: seg[2] });
      current.points.push({ x: seg[3], y: seg[4] });
      continue;
    }

    if (seg[0] === 'C') {
      current.hasCubic = true;
      current.points.push({ x: seg[1], y: seg[2] });
      current.points.push({ x: seg[3], y: seg[4] });
      current.points.push({ x: seg[5], y: seg[6] });
      continue;
    }

    const endpoint = getPathEndpoint(seg);
    if (endpoint) {
      current.points.push(endpoint);
    }
  }

  if (current?.points?.length > 0) subpaths.push(current);
  return subpaths;
}

function dedupeAdjacentPoints(points) {
  const deduped = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (!last || distance(last, point) > 0.01) {
      deduped.push(point);
    }
  }
  if (deduped.length > 2 && distance(deduped[0], deduped[deduped.length - 1]) <= 0.75) {
    deduped.pop();
  }
  return deduped;
}

function closedCatmullRomToCubicPath(points) {
  const pts = dedupeAdjacentPoints(points);
  if (pts.length < 3) return null;

  const commands = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 0; i < pts.length; i += 1) {
    const p0 = pts[(i - 1 + pts.length) % pts.length];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const p3 = pts[(i + 2) % pts.length];
    const c1 = {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    };
    const c2 = {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6,
    };
    commands.push(`C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`);
  }
  commands.push('Z');
  return commands.join(' ');
}

function smoothClosedOutlinePathD(path) {
  const subpaths = collectSubpaths(path);
  if (subpaths.length === 0) return null;
  const smoothed = [];

  for (const subpath of subpaths) {
    if (subpath.hasCubic) return null;
    const d = closedCatmullRomToCubicPath(subpath.points);
    if (!d) return null;
    smoothed.push(d);
  }

  return smoothed.join(' ');
}

export function renderPathToSvgD(obj, attrs = renderPathToSvgAttrs(obj)) {
  if (!Array.isArray(obj?.path) || obj.path.length === 0) return '';

  if (attrs?.smoothClosedOutline) {
    const smoothed = smoothClosedOutlinePathD(obj.path);
    if (smoothed) return smoothed;
  }

  return obj.path.map(formatPathCommand).join(' ');
}

/**
 * Derive the visual SVG attributes for a Fabric path object.
 *
 * @param {object} obj Fabric path JSON (partial — tolerates missing fields).
 * @returns {{ stroke: string, strokeWidth: number, fill: string, strokeLinecap: string, strokeLinejoin: string, vectorEffect: string | undefined, opacity: number }}
 */
export function renderPathToSvgAttrs(obj) {
  const rawWidth = obj.strokeWidth ?? 1;
  const isImported = isPdfImportedPath(obj);
  const fillPdfInkOutline = shouldFillPdfInkOutline(obj);
  if (fillPdfInkOutline) {
    const fill = isVisiblePaint(obj.fill) ? obj.fill : (obj.stroke ?? '#000');
    return {
      stroke: 'none',
      strokeWidth: 0,
      fill,
      fillRule: 'nonzero',
      smoothClosedOutline: true,
      strokeLinecap: obj.strokeLineCap ?? 'round',
      strokeLinejoin: obj.strokeLineJoin ?? 'round',
      vectorEffect: undefined,
      opacity: obj.opacity ?? 1,
    };
  }

  const strokeWidth = isImported
    ? Math.max(IMPORTED_PATH_MIN_STROKE_WIDTH, rawWidth)
    : rawWidth;

  // vectorEffect:non-scaling-stroke means the stroke renders at a constant
  // device-pixel width regardless of the viewBox transform / zoom. We turn
  // it on for any imported path (so thin PDF strokes never go sub-pixel),
  // and otherwise honor the legacy strokeUniform opt-in for internally
  // drawn paths that explicitly want zoom-stable strokes.
  const vectorEffect = (isImported || obj.strokeUniform)
    ? 'non-scaling-stroke'
    : undefined;

  return {
    stroke: obj.stroke ?? '#000',
    strokeWidth,
    fill: obj.fill ?? 'none',
    fillRule: undefined,
    strokeLinecap: obj.strokeLineCap ?? 'round',
    strokeLinejoin: obj.strokeLineJoin ?? 'round',
    vectorEffect,
    opacity: obj.opacity ?? 1,
  };
}
