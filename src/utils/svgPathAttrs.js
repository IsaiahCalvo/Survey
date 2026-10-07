/**
 * Pure attribute derivation for path-type Fabric objects rendered as SVG
 * <path> elements. Extracted from src/utils/svgAnnotationRenderers.jsx so
 * node-test (.mjs) suites can import it without pulling JSX through the
 * Node loader.
 *
 * PDF-imported Ink has two different
 * real-world shapes: normal open pen lines, and closed zero-width outlines
 * emitted by Adobe / Drawboard for filled marker dots and pressure ink.
 * Both render their authored commands directly. Display-time curve synthesis
 * would make an imported/legacy shape change merely by loading it or taking
 * the first erase bite. Explicit PDF `0 w` strokes remain stored as zero-width
 * hairlines and use SVG non-scaling-stroke only for device-pixel display.
 */

// Imported Ink open-stroke width is normalized at import time by
// convertInkToFabricPath. This renderer passes the stored width through for
// every path, native or imported, without a provenance-based width branch.
// Pre-normalization legacy cloud rows keep their stored (thin) width.
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

function shouldFillPdfInkOutline(obj) {
  const isPdfInk =
    isPdfImportedPath(obj) ||
    obj?.layer === 'pdf-annotations' ||
    obj?.data?.pdfAnnotationType === 'Ink' ||
    obj?.data?.pdfInkRenderMode === FILLED_PDF_INK_MODE;
  if (obj?.pdfInkRenderMode === FILLED_PDF_INK_MODE || obj?.data?.pdfInkRenderMode === FILLED_PDF_INK_MODE) {
    return true;
  }

  // Drawboard/Adobe often save marker dots and pressure ink as closed
  // zero-width outlines. Existing cloud rows may only have our 0.9 fallback
  // width, and sync/edit round-trips can strip PDF provenance entirely. Keep
  // this geometry fallback broad on purpose: a visible fill plus a closed
  // thin/no-stroke path is already a filled outline, so it must render filled
  // even if Drawboard-specific metadata is missing.
  const rawWidth = Number(obj?.strokeWidth ?? 1);
  const hasVisibleFill = isVisiblePaint(obj?.fill);
  const hasVisibleStroke = isVisiblePaint(obj?.stroke);
  const isThinOrNoStroke = rawWidth <= 1.1 || !hasVisibleStroke;
  const hasFilledClosedOutlineGeometry =
    hasVisibleFill &&
    isThinOrNoStroke &&
    hasSubstantiveClosedSubpath(obj?.path);
  if (hasFilledClosedOutlineGeometry) return true;
  if (!isPdfInk) return false;

  return rawWidth <= 1.1 && hasSubstantiveClosedSubpath(obj?.path);
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
      current = {
        points: point ? [point] : [],
        commands: [seg],
        hasCubic: false,
        closed: false,
      };
      continue;
    }

    if (!current) continue;
    current.commands.push(seg);

    if (seg[0] === 'Z' || seg[0] === 'z') {
      current.closed = true;
      continue;
    }

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

function getPointBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points || []) {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { width: maxX - minX, height: maxY - minY };
}

function isClosedSubpath(points) {
  const bounds = getPointBounds(points);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
  const closeThreshold = Math.max(0.75, Math.min(bounds.width, bounds.height) * 0.25);
  return distance(points[0], points[points.length - 1]) <= closeThreshold;
}

// Exported for pdfAnnotationImporter (item 4/5a convergence): import-time
// classification must reuse the EXACT geometry predicate the render-time
// filled-outline fallback uses, or thin-stroked pressure ink (Drawboard
// closed outlines saved with /BS width 1 instead of 0) would classify
// differently at import than it used to render.
export function hasSubstantiveClosedSubpath(path) {
  return collectSubpaths(path).some((subpath) => {
    if (!subpath.points || subpath.points.length < 3) return false;
    const bounds = getPointBounds(subpath.points);
    if (!bounds || bounds.width < 0.5 || bounds.height < 0.5) return false;
    return subpath.closed === true || isClosedSubpath(subpath.points);
  });
}

// Perf (2026-09-30): the d string is a pure function of obj.path, yet every
// SVG layer render rebuilt it for every path mark (the per-mark hit target
// re-derives it even when the visible <path> is memoised) — the largest
// self-time function while scrolling or zooming a heavily marked page. Cache
// per path array; the length / last-segment check also covers an in-place
// append. (The unused `attrs` argument no longer defaults to a full
// renderPathToSvgAttrs() pass.)
const svgPathDCache = new WeakMap();

export function renderPathToSvgD(obj, _attrs) {
  const path = obj?.path;
  if (!Array.isArray(path) || path.length === 0) return '';

  const last = path[path.length - 1];
  const cached = svgPathDCache.get(path);
  if (cached && cached.length === path.length && cached.last === last) return cached.d;
  const d = path.map(formatPathCommand).join(' ');
  svgPathDCache.set(path, { d, length: path.length, last });
  return d;
}

/**
 * Derive the visual SVG attributes for a Fabric path object.
 *
 * @param {object} obj Fabric path JSON (partial — tolerates missing fields).
 * @returns {{ stroke: string, strokeWidth: number, fill: string, strokeLinecap: string, strokeLinejoin: string, vectorEffect: string | undefined, opacity: number }}
 */
export function renderPathToSvgAttrs(obj) {
  const rawWidth = obj.strokeWidth ?? 1;
  const isPdfHairline = obj?.pdfStrokeHairline === true
    || obj?.data?.pdfStrokeHairline === true;
  const fillPdfInkOutline = shouldFillPdfInkOutline(obj);
  if (
    obj?.fillRule === 'evenodd'
    || obj?.paperEraserGeometry === 'v1'
    || (obj?.paperInkGeometry === 'v1' && obj?.fillRule === 'nonzero')
  ) {
    return {
      stroke: 'none',
      strokeWidth: 0,
      fill: isVisiblePaint(obj.fill) ? obj.fill : (obj.stroke ?? '#000'),
      fillRule: obj?.fillRule === 'nonzero' ? 'nonzero' : 'evenodd',
      // Native paper ink (and eraser-carved ink) is a FILLED outline polygon:
      // the visible stroke body IS the fill region. This flag lets hit-testing
      // treat the interior as the stroke (interior hover/click), exactly like
      // an imported authored filled-outline path.
      filledOutline: true,
      strokeLinecap: obj.strokeLineCap ?? 'round',
      strokeLinejoin: obj.strokeLineJoin ?? 'round',
      vectorEffect: undefined,
      opacity: obj.opacity ?? 1,
    };
  }
  if (fillPdfInkOutline) {
    const fill = isVisiblePaint(obj.fill) ? obj.fill : (obj.stroke ?? '#000');
    return {
      stroke: 'none',
      strokeWidth: 0,
      fill,
      fillRule: 'nonzero',
      filledOutline: true,
      strokeLinecap: obj.strokeLineCap ?? 'round',
      strokeLinejoin: obj.strokeLineJoin ?? 'round',
      vectorEffect: undefined,
      opacity: obj.opacity ?? 1,
    };
  }

  // Stored geometry width passes through unmodified. PDF hairlines keep zero
  // in persistence/export and receive a one-pixel display width only here.
  const strokeWidth = isPdfHairline ? 1 : rawWidth;

  // Ordinary annotation strokes live in page units and scale with zoom.
  // PDF `0 w` is not an invisible zero-area stroke. It is the thinnest
  // device-space hairline, conventionally one device pixel regardless of
  // the page/object CTM. Keep the stored/exported geometry at exactly zero
  // and express only its display semantics here.
  const vectorEffect = isPdfHairline ? 'non-scaling-stroke' : undefined;

  return {
    stroke: obj.stroke ?? '#000',
    strokeWidth,
    fill: obj.fill ?? 'none',
    fillRule: undefined,
    strokeLinecap: obj.strokeLineCap ?? 'round',
    strokeLinejoin: obj.strokeLineJoin ?? 'round',
    strokeMiterlimit: Number.isFinite(Number(obj.strokeMiterLimit))
      ? Number(obj.strokeMiterLimit)
      : 10,
    strokeDasharray: Array.isArray(obj.strokeDashArray)
      ? obj.strokeDashArray.map(Number)
      : undefined,
    strokeDashoffset: Number.isFinite(Number(obj.strokeDashOffset))
      ? Number(obj.strokeDashOffset)
      : 0,
    vectorEffect,
    opacity: obj.opacity ?? 1,
  };
}

/**
 * True when the rendered path is a FILLED stroke-outline (no painted stroke,
 * visible fill IS the stroke body). Covers both imported authored outlines
 * and native paper ink / eraser-carved ink
 * (`filledOutline` via fillRule evenodd or paperEraserGeometry v1).
 * Hit-testing for these paths must treat the interior as the stroke.
 *
 * @param {object|null|undefined} attrs Result of renderPathToSvgAttrs.
 * @returns {boolean}
 */
export function isFilledInkOutlineAttrs(attrs) {
  if (!attrs) return false;
  if (attrs.filledOutline !== true) return false;
  return attrs.stroke === 'none' && !!attrs.fill && attrs.fill !== 'none';
}

/**
 * Invisible hit-target paint props for a filled ink outline path.
 * Returns null when the attrs are not a filled ink outline (caller keeps the
 * plain stroke-band hit target).
 *
 * UX contract:
 * - fill 'rgba(0,0,0,0.001)' + pointerEvents 'all' → the whole visible stroke
 *   body hovers/clicks (mid-stroke, not edge-only). fillRule is forwarded so
 *   eraser-carved holes (evenodd) stay non-interactive in their interiors.
 * - Native outlines KEEP a transparent boundary stroke band (same
 *   max(12, sw, 3*inverseScale) contract as plain pen paths, screen-constant
 *   via the inverseScale floor) so hairline strokes stay grabbable.
 * - Imported-PDF ink keeps its existing hairline band (stroke 'none',
 *   sub-pixel strokeWidth) — behavior unchanged.
 *
 * @param {object} attrs Result of renderPathToSvgAttrs.
 * @param {{ strokeWidth?: number, inverseScale?: number }} [opts]
 * @returns {{ fill: string, fillRule: string|undefined, stroke: string, strokeWidth: number, pointerEvents: 'all' } | null}
 */
export function getFilledInkHitTargetProps(attrs, { strokeWidth = 1, inverseScale = 1 } = {}) {
  if (!isFilledInkOutlineAttrs(attrs)) return null;
  return {
    fill: 'rgba(0,0,0,0.001)',
    fillRule: attrs.fillRule,
    stroke: 'rgba(0,0,0,0.001)',
    strokeWidth: Math.max(12, strokeWidth || 1, 3 * inverseScale),
    pointerEvents: 'all',
  };
}
