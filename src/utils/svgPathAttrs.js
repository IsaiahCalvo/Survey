/**
 * Pure attribute derivation for path-type Fabric objects rendered as SVG
 * <path> elements. Extracted from src/utils/svgAnnotationRenderers.jsx so
 * node-test (.mjs) suites can import it without pulling JSX through the
 * Node loader. Same pattern as src/components/propertiesPanelShape.js.
 *
 * UX 2026-04-28: PDF-imported Ink has two different real-world shapes:
 * normal open pen lines, and closed zero-width outlines emitted by Adobe /
 * Drawboard for filled marker dots and pressure ink. Open lines get a
 * minimum visible width so they do not disappear at 100% zoom. Closed thin
 * outlines render as filled shapes instead of stroked paths, otherwise
 * they look like hollow rings.
 *
 * UX 2026-07-14 (zoom-scaling unification): imported strokes previously
 * carried vector-effect:non-scaling-stroke so the floor became a constant
 * device-pixel width at every zoom. Per user direction every annotation now
 * scales with zoom like rects/ellipses, so the floors below are plain
 * page-unit minimums and the stroke grows/shrinks proportionally with the
 * page — see also tests/pdfAnnotationNormalization.test.mjs.
 */

// Minimum SVG user-unit stroke width for open PDF-imported paths — a
// page-unit floor applied to the stored width; the rendered stroke scales
// with zoom from there.
const IMPORTED_PATH_MIN_STROKE_WIDTH = 2.5;
const IMPORTED_SQUIGGLY_MIN_STROKE_WIDTH = 0.6;
const IMPORTED_SQUIGGLY_MAX_STROKE_WIDTH = 1.1;
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

function isImportedSquigglyPath(obj) {
  return isPdfImportedPath(obj) && String(obj?.pdfAnnotationType || '').toLowerCase() === 'squiggly';
}

function isVisiblePaint(value) {
  return value != null && value !== '' && value !== 'none' && value !== 'transparent';
}

function extractRgbaAlpha(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([^)]+)\)/i);
  if (!match) return null;
  const alpha = Number(match[1]);
  return Number.isFinite(alpha) ? alpha : null;
}

function getEffectivePathAlpha(obj) {
  const fillAlpha = extractRgbaAlpha(obj?.fill);
  const strokeAlpha = extractRgbaAlpha(obj?.stroke);
  const paintAlpha = fillAlpha ?? strokeAlpha;
  const objectOpacity = Number(obj?.opacity ?? 1);
  if (Number.isFinite(paintAlpha)) return paintAlpha * (Number.isFinite(objectOpacity) ? objectOpacity : 1);
  return Number.isFinite(objectOpacity) ? objectOpacity : 1;
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

function getPathBoundsWithOrigin(path) {
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
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
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
  // and smoothed even if Drawboard-specific metadata is missing.
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
      current = { points: point ? [point] : [], commands: [seg], hasCubic: false };
      continue;
    }

    if (!current) continue;
    current.commands.push(seg);

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

function collectSubpathEndpoints(path) {
  const subpaths = [];
  let current = null;

  for (const seg of path || []) {
    if (!Array.isArray(seg) || seg.length === 0) continue;

    if (seg[0] === 'M') {
      if (current?.points?.length > 0) subpaths.push(current);
      const point = getPathEndpoint(seg);
      current = point ? { points: [point], commands: [seg] } : null;
      continue;
    }

    if (!current) continue;
    current.commands.push(seg);

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

function hasSubstantiveClosedSubpath(path) {
  return collectSubpaths(path).some((subpath) => {
    if (!subpath.points || subpath.points.length < 3) return false;
    const bounds = getPointBounds(subpath.points);
    if (!bounds || bounds.width < 0.5 || bounds.height < 0.5) return false;
    return isClosedSubpath(subpath.points);
  });
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

function openCatmullRomToCubicPath(points) {
  const pts = dedupeAdjacentPoints(points);
  if (pts.length < 3) return null;

  const commands = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
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
  return commands.join(' ');
}

function ellipsePathDFromBounds(bounds) {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
  const cx = bounds.minX + bounds.width / 2;
  const cy = bounds.minY + bounds.height / 2;
  const rx = bounds.width / 2;
  const ry = bounds.height / 2;
  // Four cubic arcs. This is intentionally deterministic and smooth; Drawboard
  // marker dots are stored as low-point closed ink outlines, but Adobe/Drawboard
  // render them as soft round blobs, not as the raw polygon vertices.
  const k = 0.5522847498307936;
  return [
    `M ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry}`,
    `C ${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy}`,
    'Z',
  ].join(' ');
}

function shouldRenderClosedInkAsEllipse(obj) {
  // Drawboard stores the blue/yellow/purple marker dots as low-point closed
  // Ink outlines with transparency baked into rgba(...) paint, not always in
  // Fabric's top-level opacity. If we only look at `opacity`, later sync/cache
  // round-trips render those dots as jagged polygons instead of round blobs.
  const alpha = getEffectivePathAlpha(obj);
  if (!(alpha > 0 && alpha < 0.65)) return false;
  const bounds = getPathBoundsWithOrigin(obj?.path);
  if (!bounds || bounds.width < 4 || bounds.height < 4) return false;
  const aspect = bounds.width / bounds.height;
  if (aspect < 0.45 || aspect > 2.2) return false;
  const subpaths = collectSubpaths(obj?.path);
  if (subpaths.length !== 1) return false;
  const pointCount = subpaths[0]?.points?.length || 0;
  if (pointCount < 6) return false;
  return true;
}

function smoothClosedOutlinePathD(path) {
  // Drawboard/Adobe ink frequently arrives as a filled outline path with a
  // mixed command stream: some cubic curves plus some straight L segments.
  // Low-point polygon outlines need rebuilding, but Drawboard pressure ink
  // often already contains high-quality cubic handles. Do not throw those
  // handles away: rebuilding from endpoints makes handwritten letters look
  // lumpy/angular compared with Drawboard and Adobe. Only synthesize curves
  // for paths that are mostly straight-line/polygon data.
  const subpaths = collectSubpathEndpoints(path);
  if (subpaths.length === 0) return null;
  const smoothed = [];

  for (const subpath of subpaths) {
    const cubicCount = subpath.commands.filter((seg) => Array.isArray(seg) && seg[0] === 'C').length;
    const lineCount = subpath.commands.filter((seg) => Array.isArray(seg) && seg[0] === 'L').length;
    const hasExplicitClose = subpath.commands.some((seg) => Array.isArray(seg) && seg[0] === 'Z');
    const isCubicDominant = cubicCount >= 3 && cubicCount >= lineCount * 2;

    if (isCubicDominant && hasExplicitClose) {
      smoothed.push(subpath.commands.map(formatPathCommand).join(' '));
      continue;
    }

    const d = subpath.points.length >= 3
      ? closedCatmullRomToCubicPath(subpath.points)
      : null;
    smoothed.push(d || subpath.commands.map(formatPathCommand).join(' '));
  }

  return smoothed.join(' ');
}

function smoothOpenStrokePathD(path) {
  const subpaths = collectSubpathEndpoints(path);
  if (subpaths.length === 0) return null;
  const smoothed = [];

  for (const subpath of subpaths) {
    const d = subpath.points.length >= 3
      ? openCatmullRomToCubicPath(subpath.points)
      : null;
    smoothed.push(d || subpath.commands.map(formatPathCommand).join(' '));
  }

  return smoothed.join(' ');
}

export function renderPathToSvgD(obj, attrs = renderPathToSvgAttrs(obj)) {
  if (!Array.isArray(obj?.path) || obj.path.length === 0) return '';

  if (attrs?.smoothClosedOutline) {
    if (attrs?.smoothClosedOutlineAsEllipse) {
      const ellipseD = ellipsePathDFromBounds(getPathBoundsWithOrigin(obj.path));
      if (ellipseD) return ellipseD;
    }
    const smoothed = smoothClosedOutlinePathD(obj.path);
    if (smoothed) return smoothed;
  }

  if (attrs?.smoothOpenStroke) {
    const smoothed = smoothOpenStrokePathD(obj.path);
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
  const isPdfInkLike =
    isImported ||
    obj?.layer === 'pdf-annotations' ||
    obj?.data?.pdfAnnotationType === 'Ink';
  const fillPdfInkOutline = shouldFillPdfInkOutline(obj);
  if (obj?.fillRule === 'evenodd' || obj?.paperEraserGeometry === 'v1') {
    return {
      stroke: 'none',
      strokeWidth: 0,
      fill: isVisiblePaint(obj.fill) ? obj.fill : (obj.stroke ?? '#000'),
      fillRule: 'evenodd',
      // Native paper ink (and eraser-carved ink) is a FILLED outline polygon:
      // the visible stroke body IS the fill region. This flag lets hit-testing
      // treat the interior as the stroke (interior hover/click), exactly like
      // the imported-PDF smoothClosedOutline branch below.
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
      smoothClosedOutline: true,
      smoothClosedOutlineAsEllipse: shouldRenderClosedInkAsEllipse(obj),
      strokeLinecap: obj.strokeLineCap ?? 'round',
      strokeLinejoin: obj.strokeLineJoin ?? 'round',
      vectorEffect: undefined,
      opacity: obj.opacity ?? 1,
    };
  }

  const strokeWidth = isImportedSquigglyPath(obj)
    ? Math.min(IMPORTED_SQUIGGLY_MAX_STROKE_WIDTH, Math.max(IMPORTED_SQUIGGLY_MIN_STROKE_WIDTH, rawWidth))
    : isImported
      ? Math.max(IMPORTED_PATH_MIN_STROKE_WIDTH, rawWidth)
    : rawWidth;

  // UX 2026-07-14 (zoom-scaling unification): every annotation stroke lives
  // in PAGE units and scales with zoom, exactly like user-drawn rects and
  // ellipses — imported ink included, per explicit user direction ("even
  // imported annotations have to follow that"). The old
  // vector-effect:non-scaling-stroke pin (constant device-px width at every
  // zoom) is gone; low-zoom visibility is preserved by the page-unit
  // minimum widths above, which now scale proportionally instead of
  // freezing. Legacy strokeUniform opt-ins are ignored for the same reason.
  const vectorEffect = undefined;

  return {
    stroke: obj.stroke ?? '#000',
    strokeWidth,
    fill: obj.fill ?? 'none',
    fillRule: undefined,
    smoothOpenStroke: isPdfInkLike && isVisiblePaint(obj?.stroke),
    strokeLinecap: obj.strokeLineCap ?? 'round',
    strokeLinejoin: obj.strokeLineJoin ?? 'round',
    vectorEffect,
    opacity: obj.opacity ?? 1,
  };
}

/**
 * True when the rendered path is a FILLED stroke-outline (no painted stroke,
 * visible fill IS the stroke body). Covers both the imported-PDF ink branch
 * (`smoothClosedOutline`) and native paper ink / eraser-carved ink
 * (`filledOutline` via fillRule evenodd or paperEraserGeometry v1).
 * Hit-testing for these paths must treat the interior as the stroke.
 *
 * @param {object|null|undefined} attrs Result of renderPathToSvgAttrs.
 * @returns {boolean}
 */
export function isFilledInkOutlineAttrs(attrs) {
  if (!attrs) return false;
  if (attrs.filledOutline !== true && attrs.smoothClosedOutline !== true) return false;
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
  const isNativeOutline = attrs.smoothClosedOutline !== true;
  return {
    fill: 'rgba(0,0,0,0.001)',
    fillRule: attrs.fillRule,
    stroke: isNativeOutline ? 'rgba(0,0,0,0.001)' : 'none',
    strokeWidth: isNativeOutline
      ? Math.max(12, strokeWidth || 1, 3 * inverseScale)
      : Math.max(0.75 * inverseScale, 0.75),
    pointerEvents: 'all',
  };
}
